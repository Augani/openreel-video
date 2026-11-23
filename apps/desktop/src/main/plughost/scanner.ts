import type { NativePluginDescriptor } from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { HelperError, HelperProcess, type HelperSpawnOptions } from "./helper-process";
import { PluginBlocklist, type BlockKind } from "./blocklist";
import { discoverVst3 } from "./scan-paths";
import type { PluginHelperFormat } from "./helper-path";

/**
 * The plugin scan. Nothing is trusted: the enumeration runs in a helper process, and every plugin is validated in a helper
 * process of its own (instantiate, allocate, render noise, look for NaN) under a timeout. A plugin that crashes or hangs its
 * helper costs one helper process, is recorded in the blocklist with the reason, and is skipped from then on.
 */

export const LIST_TIMEOUT_MS = 20_000;
export const PROBE_TIMEOUT_MS = 15_000;
export const SCAN_CONCURRENCY = 2;

export interface ScannerDeps {
  /** The command line of one helper process for a mode; `format` picks the Audio Unit helper (default) or the VST3 helper. */
  readonly helper: (mode: string, format?: PluginHelperFormat) => HelperSpawnOptions | null;
  readonly blocklist: PluginBlocklist;
  readonly vst3Roots: readonly string[];
  readonly probeTimeoutMs?: number;
  readonly listTimeoutMs?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ScanResult {
  readonly plugins: NativePluginDescriptor[];
  readonly helperAvailable: boolean;
  readonly helperError?: string;
  readonly searchedVst3: readonly string[];
}

interface ListedComponent {
  id: string;
  format: "au";
  name: string;
  vendor: string;
  version?: string;
  category?: string;
  hasCustomView?: boolean;
}

interface ProbeOutcome {
  readonly ok: boolean;
  readonly kind?: BlockKind;
  readonly reason?: string;
  readonly latencySamples?: number;
  readonly tailSeconds?: number;
  readonly parameterCount?: number;
  /** VST3: the real class id, name and vendor the plugin reported once loaded. */
  readonly classId?: string;
  readonly name?: string;
  readonly vendor?: string;
  readonly version?: string;
  readonly category?: string;
}

const kindOf = (error: unknown): BlockKind => (error instanceof HelperError && error.kind === "timeout" ? "timeout" : error instanceof HelperError && (error.kind === "crash" || error.kind === "protocol") ? "crash" : "invalid");

/** One plugin, one helper process, one deadline. */
export async function probePlugin(spawnOptions: HelperSpawnOptions, id: string, timeoutMs: number, pluginPath?: string): Promise<ProbeOutcome> {
  const helper = new HelperProcess(spawnOptions);
  try {
    await helper.start(Math.min(timeoutMs, 10_000));
    const reply = await helper.request({ type: "probe", id, ...(pluginPath ? { path: pluginPath } : {}) }, timeoutMs);
    const json = reply.json;
    const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
    return {
      ok: true,
      ...(typeof json.classId === "string" && /^[0-9A-Fa-f]{32}$/.test(json.classId) ? { classId: json.classId.toUpperCase() } : {}),
      ...(text(json.name) ? { name: text(json.name) } : {}),
      ...(text(json.vendor) ? { vendor: text(json.vendor) } : {}),
      ...(text(json.version) ? { version: text(json.version) } : {}),
      ...(text(json.category) ? { category: text(json.category) } : {}),
      latencySamples: typeof json.latencySamples === "number" ? json.latencySamples : 0,
      tailSeconds: typeof json.tailSeconds === "number" ? json.tailSeconds : 0,
      parameterCount: Array.isArray(json.parameters) ? json.parameters.length : 0,
    };
  } catch (error) {
    const kind = kindOf(error);
    const detail = error instanceof HelperError && error.detail ? ` (${error.detail.split("\n").pop()})` : "";
    return { ok: false, kind, reason: `${error instanceof Error ? error.message : String(error)}${kind === "crash" ? detail : ""}` };
  } finally {
    helper.kill();
  }
}

async function listComponents(spawnOptions: HelperSpawnOptions, timeoutMs: number): Promise<ListedComponent[]> {
  const helper = new HelperProcess(spawnOptions);
  try {
    await helper.start();
    const reply = await helper.request({ type: "list" }, timeoutMs);
    const components = reply.json.components;
    return Array.isArray(components) ? (components as ListedComponent[]).filter((c) => c && typeof c.id === "string" && typeof c.name === "string") : [];
  } finally {
    helper.kill();
  }
}

export async function scanPlugins(deps: ScannerDeps): Promise<ScanResult> {
  await deps.blocklist.load();
  const out: NativePluginDescriptor[] = [];
  let helperAvailable = false;
  let helperError: string | undefined;

  const listOptions = deps.helper("serve");
  let listed: ListedComponent[] = [];
  if (listOptions) {
    try {
      listed = await listComponents(listOptions, deps.listTimeoutMs ?? LIST_TIMEOUT_MS);
      helperAvailable = true;
    } catch (error) {
      helperError = error instanceof Error ? error.message : String(error);
    }
  } else {
    helperError = "no plugin helper is available for this platform in this build";
  }

  let done = 0;
  const total = listed.length;
  const queue = [...listed];
  const worker = async (): Promise<void> => {
    for (let component = queue.shift(); component; component = queue.shift()) {
      const base = { id: component.id, format: "au" as const, name: component.name, vendor: component.vendor ?? "", ...(component.version ? { version: component.version } : {}), ...(component.category ? { category: component.category } : {}), hasCustomView: Boolean(component.hasCustomView) };
      const block = deps.blocklist.get(component.id, component.version);
      if (block) {
        out.push({ ...base, status: "blocked", statusReason: block.reason });
      } else {
        const outcome = await probePlugin(deps.helper("serve") as HelperSpawnOptions, component.id, deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
        if (outcome.ok) {
          out.push({ ...base, status: "ok", latencySamples: outcome.latencySamples, tailSeconds: outcome.tailSeconds, parameterCount: outcome.parameterCount });
        } else {
          // Crashes and hangs are remembered; a plain refusal (unsupported channel layout, ...) is reported this time only.
          if (outcome.kind === "crash" || outcome.kind === "timeout") await deps.blocklist.add(component.id, outcome.kind, outcome.reason ?? "failed validation", component.version);
          out.push({ ...base, status: "blocked", statusReason: outcome.reason });
        }
      }
      done += 1;
      deps.onProgress?.(done, total);
    }
  };
  if (helperAvailable) await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));

  // VST3: bundles are found by walking the standard folders (no plugin code runs), then each one is validated in a helper
  // process of its own exactly like an Audio Unit. Without a VST3 helper in this build they are listed as unsupported.
  const vst3 = await discoverVst3(deps.vst3Roots);
  const vst3Spawn = deps.helper("serve", "vst3");
  const vst3Queue = [...vst3];
  const vst3Total = total + vst3.length;
  const vst3Worker = async (): Promise<void> => {
    for (let bundle = vst3Queue.shift(); bundle; bundle = vst3Queue.shift()) {
      const base = { id: bundle.id, format: "vst3" as const, name: bundle.name, vendor: bundle.vendor, ...(bundle.version ? { version: bundle.version } : {}), path: bundle.path };
      const block = deps.blocklist.get(bundle.id, bundle.version);
      if (block) {
        out.push({ ...base, status: "blocked", statusReason: block.reason });
      } else if (!vst3Spawn) {
        out.push({ ...base, status: "unsupported", statusReason: "this build has no VST3 host helper (openreel-vst3host); only Audio Units can be loaded" });
      } else {
        const outcome = await probePlugin(deps.helper("serve", "vst3") as HelperSpawnOptions, bundle.id, deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS, bundle.path);
        if (outcome.ok) {
          // The class id read from the loaded plugin is the stable id; a bundle without moduleinfo.json only had a path hash.
          const id = outcome.classId ? `vst3:${outcome.classId}` : bundle.id;
          const known = id === bundle.id ? block : deps.blocklist.get(id, outcome.version ?? bundle.version);
          const merged = { ...base, id, name: outcome.name ?? bundle.name, vendor: outcome.vendor ?? bundle.vendor, ...((outcome.version ?? bundle.version) ? { version: outcome.version ?? bundle.version } : {}), ...(outcome.category ? { category: outcome.category } : {}) };
          if (known) out.push({ ...merged, status: "blocked", statusReason: known.reason });
          else out.push({ ...merged, status: "ok", latencySamples: outcome.latencySamples, tailSeconds: outcome.tailSeconds, parameterCount: outcome.parameterCount });
        } else {
          if (outcome.kind === "crash" || outcome.kind === "timeout") await deps.blocklist.add(bundle.id, outcome.kind, outcome.reason ?? "failed validation", bundle.version);
          out.push({ ...base, status: "blocked", statusReason: outcome.reason });
        }
      }
      done += 1;
      deps.onProgress?.(done, vst3Total);
    }
  };
  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, vst3Worker));
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { plugins: out, helperAvailable, ...(helperError ? { helperError } : {}), searchedVst3: deps.vst3Roots };
}
