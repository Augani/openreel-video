import type {
  NativePluginDescriptor,
  NativePluginParameter,
  NativePluginRenderRequest,
  NativePluginRenderResult,
} from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { NativePluginCancelledError, NativePluginRenderError, NativePluginUnavailableError } from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { HelperError, HelperProcess, type HelperSpawnOptions } from "./helper-process";
import { PluginBlocklist, type BlockKind } from "./blocklist";
import { renderThroughHelper } from "./render";
import { scanPlugins, type ScanResult } from "./scanner";
import type { PluginHelperFormat } from "./helper-path";

/**
 * The editor-side owner of plugin hosting: the last scan, the blocklist, concurrent render jobs and the plugin window sessions.
 * It knows nothing about Electron; the IPC layer and the tests drive it directly.
 */

export const MAX_CONCURRENT_RENDERS = 2;

export interface HostServiceDeps {
  readonly helper: (mode: string, format?: PluginHelperFormat) => HelperSpawnOptions | null;
  readonly blocklist: PluginBlocklist;
  readonly vst3Roots: readonly string[];
  readonly probeTimeoutMs?: number;
}

export interface RenderOutcome {
  readonly ok: boolean;
  readonly kind?: "unavailable" | "failed" | "cancelled";
  readonly message?: string;
  readonly result?: NativePluginRenderResult;
}

export interface UiEvent {
  readonly type: "opened" | "paramChanged" | "state" | "closed" | "error";
  readonly sessionId: string;
  readonly key?: string;
  readonly value?: number;
  readonly state?: string | null;
  readonly parameters?: NativePluginParameter[];
  readonly message?: string;
}

export interface DescribeResult {
  readonly latencySamples: number;
  readonly tailSeconds: number;
  readonly parameters: NativePluginParameter[];
  readonly state: string | null;
}

export class PlugHostService {
  private scan: ScanResult | null = null;
  private scanning: Promise<ScanResult> | null = null;
  private readonly jobs = new Map<string, { cancelled: boolean; helper?: HelperProcess }>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly ui = new Map<string, HelperProcess>();
  private nextSession = 1;

  constructor(private readonly deps: HostServiceDeps) {}

  get lastScan(): ScanResult | null {
    return this.scan;
  }

  /** Ids a render can use right now: validated Audio Units that are not blocked. */
  usableIds(): Set<string> {
    return new Set((this.scan?.plugins ?? []).filter((p) => p.status === "ok").map((p) => p.id));
  }

  async scanNow(onProgress?: (done: number, total: number) => void): Promise<ScanResult> {
    if (this.scanning) return this.scanning;
    this.scanning = scanPlugins({ helper: this.deps.helper, blocklist: this.deps.blocklist, vst3Roots: this.deps.vst3Roots, probeTimeoutMs: this.deps.probeTimeoutMs, onProgress })
      .then((result) => (this.scan = result))
      .finally(() => {
        this.scanning = null;
      });
    return this.scanning;
  }

  async ensureScanned(): Promise<ScanResult> {
    return this.scan ?? this.scanNow();
  }

  async unblock(id: string): Promise<ScanResult> {
    await this.deps.blocklist.remove(id);
    return this.scanNow();
  }

  private async slot(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    job.helper?.kill();
    return true;
  }

  /** Renders a clip source through a plugin. Never throws: the outcome says unavailable (bypass), failed (loud) or cancelled. */
  async render(jobId: string, request: NativePluginRenderRequest, onProgress?: (fraction: number) => void): Promise<RenderOutcome> {
    const scan = await this.ensureScanned();
    const known = scan.plugins.find((p) => p.id === request.pluginId);
    if (!known) return { ok: false, kind: "unavailable", message: `plugin ${request.pluginId} is not installed` };
    if (known.status !== "ok") return { ok: false, kind: "unavailable", message: `${known.name} cannot be used: ${known.statusReason ?? known.status}` };
    const spawn = this.deps.helper("serve", known.format);
    if (!spawn) return { ok: false, kind: "unavailable", message: "no plugin helper is available in this build" };
    const job = { cancelled: false, helper: undefined as HelperProcess | undefined };
    this.jobs.set(jobId, job);
    const release = await this.slot();
    try {
      if (job.cancelled) return { ok: false, kind: "cancelled", message: "cancelled" };
      const result = await renderThroughHelper(spawn, request, { ...(known.path ? { pluginPath: known.path } : {}), signal: { get aborted() { return job.cancelled; } }, onProgress, onHelper: (h) => { job.helper = h; if (job.cancelled) h.kill(); } });
      return { ok: true, result };
    } catch (error) {
      if (error instanceof NativePluginCancelledError || job.cancelled) return { ok: false, kind: "cancelled", message: "cancelled" };
      const message = error instanceof Error ? error.message : String(error);
      // A plugin that took the helper down mid-render joins the blocklist: the next clip must not take it down again.
      if (error instanceof NativePluginRenderError && /killed by|exited with code|did not answer/.test(message)) {
        const kind: BlockKind = /did not answer/.test(message) ? "timeout" : "crash";
        await this.deps.blocklist.add(request.pluginId, kind, message, known.version).catch(() => undefined);
        this.scan = { ...scan, plugins: scan.plugins.map((p) => (p.id === request.pluginId ? ({ ...p, status: "blocked", statusReason: message } as NativePluginDescriptor) : p)) };
      }
      if (error instanceof NativePluginUnavailableError) return { ok: false, kind: "unavailable", message };
      return { ok: false, kind: "failed", message };
    } finally {
      this.jobs.delete(jobId);
      release();
    }
  }

  /** Opens the plugin once to read its parameters (names, ranges, current values), latency and state. */
  async describe(pluginId: string, state?: string): Promise<DescribeResult> {
    const known = (await this.ensureScanned()).plugins.find((p) => p.id === pluginId);
    const spawn = this.deps.helper("serve", known?.format ?? (pluginId.startsWith("vst3:") ? "vst3" : "au"));
    if (!spawn) throw new NativePluginUnavailableError(pluginId, "no plugin helper is available in this build");
    const helper = new HelperProcess(spawn);
    try {
      await helper.start();
      const opened = await helper.request({ type: "open", id: pluginId, ...(known?.path ? { path: known.path } : {}), sampleRate: 48000, channels: 2, maxBlock: 512, ...(state ? { state } : {}) }, 25_000);
      const stateReply = await helper.request({ type: "getState" }, 10_000);
      return {
        latencySamples: Number(opened.json.latencySamples ?? 0),
        tailSeconds: Number(opened.json.tailSeconds ?? 0),
        parameters: (opened.json.parameters ?? []) as NativePluginParameter[],
        state: typeof stateReply.json.state === "string" ? stateReply.json.state : null,
      };
    } catch (error) {
      throw error instanceof HelperError ? new NativePluginRenderError(pluginId, error.message) : error;
    } finally {
      helper.kill();
    }
  }

  /**
   * The plugin's own editor window, in a helper process of its own (so a UI crash cannot touch a render). Parameter edits and
   * the final state stream back as events; the caller turns them into an undoable edit.
   */
  async openUi(pluginId: string, init: { state?: string; values?: Record<string, number>; title: string }, emit: (event: UiEvent) => void): Promise<string> {
    const known = (await this.ensureScanned()).plugins.find((p) => p.id === pluginId);
    const spawn = this.deps.helper("ui", known?.format ?? (pluginId.startsWith("vst3:") ? "vst3" : "au"));
    if (!spawn) throw new NativePluginUnavailableError(pluginId, "no plugin helper is available in this build");
    const sessionId = `ui-${this.nextSession++}`;
    const helper = new HelperProcess(spawn);
    this.ui.set(sessionId, helper);
    helper.on("event", (json: Record<string, unknown>) => {
      if (json.type === "paramChanged") emit({ type: "paramChanged", sessionId, key: String(json.key), value: Number(json.value) });
      else if (json.type === "uiState") emit({ type: "state", sessionId, state: typeof json.state === "string" ? json.state : null, parameters: (json.parameters ?? []) as NativePluginParameter[] });
      else if (json.type === "uiClosed") {
        emit({ type: "closed", sessionId });
        this.ui.delete(sessionId);
        helper.kill();
      }
    });
    helper.on("exit", (error: HelperError) => {
      if (this.ui.delete(sessionId)) emit({ type: "error", sessionId, message: error.message });
    });
    try {
      await helper.start();
      await helper.request({ type: "ui-open", id: pluginId, ...(known?.path ? { path: known.path } : {}), title: init.title, ...(init.state ? { state: init.state } : {}), params: init.values ?? {} }, 25_000);
      emit({ type: "opened", sessionId });
      return sessionId;
    } catch (error) {
      this.ui.delete(sessionId);
      helper.kill();
      throw error instanceof HelperError ? new NativePluginRenderError(pluginId, error.message) : error;
    }
  }

  /** Moves a parameter in an open plugin window; the window and the plugin's observers see it like a user edit. */
  async setUiParameter(sessionId: string, key: string, value: number): Promise<boolean> {
    const helper = this.ui.get(sessionId);
    if (!helper) return false;
    await helper.request({ type: "ui-set", key, value }, 3000);
    return true;
  }

  closeUi(sessionId: string): boolean {
    const helper = this.ui.get(sessionId);
    if (!helper) return false;
    void helper.request({ type: "ui-close" }, 3000).catch(() => helper.kill());
    return true;
  }

  dispose(): void {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      job.helper?.kill();
    }
    for (const helper of this.ui.values()) helper.kill();
    this.ui.clear();
  }
}
