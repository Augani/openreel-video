import { isValidPluginId } from "../../shared/plughost-protocol";
import type { NativePluginLane } from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { LiveChain, messageSummary, type LiveChainStats, type LiveOpenResult, type LiveStepConfig } from "./live-chain";
import type { HelperSpawnOptions } from "./helper-process";
import type { PluginHelperFormat } from "./helper-path";

/**
 * Live insert sessions: one LiveChain per rack that plays live, each with its own MessagePort to the renderer's AudioWorklet.
 * Lives in its own module and is only imported (dynamically) when a rack first goes live, so a session that never uses live
 * inserts never loads any of this.
 */

export interface LivePortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  start(): void;
  close(): void;
}

export interface LiveHostDeps {
  /** The scan result and the helper command lines (PlugHostService.ensureScanned / helper). */
  ensureScanned(): Promise<{ plugins: ReadonlyArray<{ id: string; format: PluginHelperFormat; status: string; name: string; statusReason?: string; path?: string }> }>;
  helper(mode: string, format?: PluginHelperFormat): HelperSpawnOptions | null;
  /** Creates a MessageChannelMain pair: `local` stays here, `remote` goes to the renderer. */
  createChannel(): { local: LivePortLike; remote: unknown };
}

export interface LiveOpenArgs {
  readonly sessionId: string;
  readonly steps: ReadonlyArray<{ pluginId: string; effectId: string; state?: string; values: Record<string, number>; automation: Record<string, NativePluginLane> }>;
  readonly sampleRate: number;
  readonly blockFrames: number;
  /** Hands the renderer its end of the port. */
  readonly deliver: (remote: unknown) => void;
}

export type LiveOpenOutcome =
  | { readonly ok: true; readonly sessionId: string; readonly open: LiveOpenResult }
  | { readonly ok: false; readonly kind: "unavailable" | "failed"; readonly message: string };

interface Session {
  readonly chain: LiveChain;
  readonly port: LivePortLike;
}

export const MAX_LIVE_SESSIONS = 12;

export class LiveInsertService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly deps: LiveHostDeps) {}

  get count(): number {
    return this.sessions.size;
  }

  async open(args: LiveOpenArgs): Promise<LiveOpenOutcome> {
    this.close(args.sessionId);
    if (this.sessions.size >= MAX_LIVE_SESSIONS) return { ok: false, kind: "unavailable", message: `at most ${MAX_LIVE_SESSIONS} racks can play live at once` };
    const scan = await this.deps.ensureScanned();
    const steps: LiveStepConfig[] = [];
    for (const step of args.steps) {
      if (!isValidPluginId(step.pluginId)) return { ok: false, kind: "unavailable", message: `invalid plugin id ${step.pluginId}` };
      const known = scan.plugins.find((p) => p.id === step.pluginId);
      if (!known) return { ok: false, kind: "unavailable", message: `plugin ${step.pluginId} is not installed` };
      if (known.status !== "ok") return { ok: false, kind: "unavailable", message: `${known.name} cannot be used: ${known.statusReason ?? known.status}` };
      const spawn = this.deps.helper("serve", known.format);
      if (!spawn) return { ok: false, kind: "unavailable", message: "no plugin helper is available in this build" };
      steps.push({ pluginId: step.pluginId, effectId: step.effectId, ...(step.state ? { state: step.state } : {}), values: step.values, automation: step.automation, spawn, ...(known.path ? { pluginPath: known.path } : {}) });
    }
    const { local, remote } = this.deps.createChannel();
    const chain = new LiveChain({
      steps,
      sampleRate: args.sampleRate,
      blockFrames: args.blockFrames,
      post: (message) => {
        try {
          local.postMessage(message);
        } catch {
          /* the renderer went away; the session is closed by the caller */
        }
      },
    });
    local.on("message", (event) => chain.onMessage(event.data as Parameters<LiveChain["onMessage"]>[0]));
    local.start();
    try {
      const open = await chain.open();
      this.sessions.set(args.sessionId, { chain, port: local });
      args.deliver(remote);
      return { ok: true, sessionId: args.sessionId, open };
    } catch (error) {
      chain.dispose();
      local.close();
      return { ok: false, kind: "failed", message: messageSummary(error) };
    }
  }

  setValues(sessionId: string, effectId: string, values?: Record<string, number>, automation?: Record<string, NativePluginLane>): boolean {
    return this.sessions.get(sessionId)?.chain.setValues(effectId, values, automation) ?? false;
  }

  stats(sessionId: string): LiveChainStats | null {
    return this.sessions.get(sessionId)?.chain.stats() ?? null;
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.chain.dispose();
    try {
      session.port.close();
    } catch {
      /* already closed */
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
