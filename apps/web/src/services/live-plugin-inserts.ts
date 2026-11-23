import {
  MASTER_RACK_TARGET,
  activePluginRackTargets,
  getMasterClock,
  getRealtimeAudioGraph,
  pluginRackSteps,
  rackIsLive,
  type LiveInsertKind,
  type NativePluginStep,
  type Project,
} from "@openreel/core";
import { createLiveInsertNode, type LiveInsertNode } from "@openreel/core/audio/native-plugin/live/live-insert-node";
import type { OpenReelPlughostBridge } from "../types/global";
import { getPluginRackPreview } from "./plugin-rack-preview";
import { readLiveBlockFrames, useLiveInsertState, type LiveInsertStatus } from "./live-plugin-insert-state";

/**
 * Live (realtime) plugin inserts for the preview, desktop only. Loaded lazily (see live-plugin-insert-state.ts).
 *
 * For every track / bus / master rack that has plugins and whose preview is LIVE (the default), the controller opens one session in
 * the main process (a helper per plugin), gets a MessagePort for it, builds a worklet node around that port and splices the node
 * into the audio graph in front of the target's built-in rack. While the transport runs the rack's signal streams through the
 * helpers block by block; a parameter edit reaches the plugin with the next block.
 *
 * The cached offline render is untouched: it keeps being produced when playback is stopped (the export reuses it), and it is what
 * a RENDERED rack plays. While a target plays live its stem is simply not substituted (PluginRackPreview.setLiveTargets).
 */

/** After the transport stops the streams keep running this long so delay and reverb tails ring out. */
const TAIL_SECONDS = 3;
const PORT_TIMEOUT_MS = 3000;

interface LiveRecord {
  readonly key: string;
  readonly kind: LiveInsertKind;
  readonly id: string;
  readonly signature: string;
  readonly sessionId: string;
  readonly node: LiveInsertNode;
  readonly effectIds: readonly string[];
  /** JSON of each step's values and automation as last sent, by effect id. */
  sent: Map<string, string>;
  failed: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

interface Desired {
  readonly key: string;
  readonly kind: LiveInsertKind;
  readonly id: string;
  readonly steps: NativePluginStep[];
}

const portWaiters = new Map<string, (port: MessagePort) => void>();
/** Ports that arrived before anyone asked for them (the host hands the port over before it answers the open request). */
const arrivedPorts = new Map<string, MessagePort>();
let listening = false;
const listenForPorts = (): void => {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (event) => {
    const data = event.data as { type?: string; sessionId?: string } | null;
    if (event.source !== window || data?.type !== "openreel:plughost-live-port" || typeof data.sessionId !== "string" || !event.ports[0]) return;
    const id = data.sessionId;
    const waiter = portWaiters.get(id);
    if (waiter) {
      portWaiters.delete(id);
      waiter(event.ports[0]);
    } else {
      arrivedPorts.set(id, event.ports[0]);
      // a port nobody claims (the open was abandoned) is not kept forever
      setTimeout(() => {
        arrivedPorts.get(id)?.close();
        arrivedPorts.delete(id);
      }, 60_000);
    }
  });
};

const waitForPort = (sessionId: string): Promise<MessagePort> =>
  new Promise((resolve, reject) => {
    const early = arrivedPorts.get(sessionId);
    if (early) {
      arrivedPorts.delete(sessionId);
      resolve(early);
      return;
    }
    const timer = setTimeout(() => {
      portWaiters.delete(sessionId);
      reject(new Error("the plugin host did not hand over its audio port"));
    }, PORT_TIMEOUT_MS);
    portWaiters.set(sessionId, (port) => {
      clearTimeout(timer);
      resolve(port);
    });
  });

/**
 * Opens one live session in the main process and wraps it in a worklet node on `ctx`: the shared core of the controller and of the
 * end-to-end probe. Throws with the host's reason when the session cannot be opened.
 */
export async function openLiveInsertNode(
  ctx: BaseAudioContext,
  steps: readonly NativePluginStep[],
  blockFrames: 128 | 256 | 512,
  handlers: { onStats?: Parameters<typeof createLiveInsertNode>[1]["onStats"]; onHostStatus?: Parameters<typeof createLiveInsertNode>[1]["onHostStatus"] } = {},
): Promise<{ node: LiveInsertNode; sessionId: string; open: { pluginLatencyFrames: number; prefillBlocks: number; blockFrames: number; roundTripMs: { p50: number; p95: number; max: number } } }> {
  const bridge = window.openreel?.plughost;
  if (!bridge?.liveOpen) throw new Error("live plugin inserts need the OpenReel desktop app");
  const sessionId = `live-${crypto.randomUUID()}`;
  listenForPorts();
  const result = await bridge.liveOpen({
    sessionId,
    steps: steps.map((step) => ({ pluginId: step.pluginId, effectId: step.effectId, ...(step.state ? { state: step.state } : {}), values: { ...step.values }, automation: toLane(step) })),
    sampleRate: ctx.sampleRate,
    blockFrames,
  });
  if (!result.ok) throw new Error(result.message);
  let port: MessagePort;
  try {
    port = await waitForPort(sessionId);
  } catch (error) {
    void bridge.liveClose?.(sessionId);
    throw error;
  }
  const node = createLiveInsertNode(ctx, { blockFrames: result.blockFrames, prefillBlocks: result.prefillBlocks, pluginLatencyFrames: result.pluginLatencyFrames, ...handlers });
  node.connectHost(port);
  await node.whenReady();
  return { node, sessionId, open: result };
}

const keyOf = (kind: LiveInsertKind, id: string): string => `${kind}:${id}`;
const stepSignature = (steps: readonly NativePluginStep[]): string => JSON.stringify(steps.map((s) => [s.effectId, s.pluginId, s.state ?? ""]));
const stepPayload = (step: NativePluginStep): string => JSON.stringify([step.values, step.automation]);

const toLane = (step: NativePluginStep): Record<string, Array<readonly [number, number]>> => Object.fromEntries(Object.entries(step.automation).map(([key, lane]) => [key, lane.map(([t, v]) => [t, v] as const)]));

class LivePluginInserts {
  private records = new Map<string, LiveRecord>();
  private failedSignatures = new Map<string, string>();
  private latest: Project | null = null;
  private running: Promise<void> | null = null;
  private pending = false;
  private playing = false;
  private unsubscribe: (() => void) | null = null;

  private get bridge(): OpenReelPlughostBridge | undefined {
    return window.openreel?.plughost;
  }

  sync(project: Project): void {
    this.latest = project;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
  }

  private async run(): Promise<void> {
    do {
      this.pending = false;
      const project = this.latest;
      if (project) await this.reconcile(project).catch((error: unknown) => console.warn("[live-insert] reconcile failed", error));
    } while (this.pending);
  }

  private desired(project: Project): Map<string, Desired> {
    const out = new Map<string, Desired>();
    for (const target of activePluginRackTargets(project.timeline)) {
      if (!rackIsLive(target.rack)) continue;
      const steps = pluginRackSteps(target.rack, { preview: true });
      if (steps.length === 0) continue;
      const kind: LiveInsertKind = target.kind;
      out.set(keyOf(kind, target.id), { key: keyOf(kind, target.id), kind, id: target.id, steps });
    }
    return out;
  }

  private setStatus(key: string, status: LiveInsertStatus | null): void {
    const targets = { ...useLiveInsertState.getState().targets };
    if (status) targets[key] = status;
    else delete targets[key];
    useLiveInsertState.setState({ targets }, true);
  }

  private async reconcile(project: Project): Promise<void> {
    const bridge = this.bridge;
    if (!bridge?.liveOpen) return;
    const graph = getRealtimeAudioGraph();
    this.watchTransport(graph);
    const wanted = this.desired(project);
    for (const [key, record] of [...this.records]) {
      if (!wanted.has(key)) this.dispose(record);
    }
    for (const key of Object.keys(useLiveInsertState.getState().targets)) {
      if (!wanted.has(key)) {
        this.setStatus(key, null);
        this.failedSignatures.delete(key);
      }
    }
    for (const want of wanted.values()) {
      const signature = stepSignature(want.steps);
      const existing = this.records.get(want.key);
      if (existing && existing.signature === signature) {
        this.pushChanges(existing, want.steps);
        continue;
      }
      if (!existing && this.failedSignatures.get(want.key) === signature) continue;
      await this.open(want, signature, graph);
    }
    this.publishTargets();
  }

  /** Values and automation that changed since the last send reach the helpers without reopening anything. */
  private pushChanges(record: LiveRecord, steps: readonly NativePluginStep[]): void {
    for (const step of steps) {
      const payload = stepPayload(step);
      if (record.sent.get(step.effectId) === payload) continue;
      record.sent.set(step.effectId, payload);
      void this.bridge?.liveSet?.(record.sessionId, step.effectId, { ...step.values }, toLane(step));
    }
  }

  private async open(want: Desired, signature: string, graph: ReturnType<typeof getRealtimeAudioGraph>): Promise<void> {
    const bridge = this.bridge;
    if (!bridge?.liveOpen) return;
    const blockFrames = readLiveBlockFrames();
    const sampleRate = graph.getAudioContext().sampleRate;
    const previous = useLiveInsertState.getState().targets[want.key];
    this.setStatus(want.key, { phase: "opening", latencyMs: 0, blockFrames, underruns: 0, lateBlocks: 0 });
    let opened;
    try {
      opened = await openLiveInsertNode(graph.getAudioContext(), want.steps, blockFrames, {
        onStats: (stats, latencyFrames) => this.onStats(want.key, stats.underruns, stats.lateBlocks, latencyFrames, blockFrames, sampleRate),
        onHostStatus: (state, reason) => this.onHostStatus(want.key, state, reason),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failedSignatures.set(want.key, signature);
      // "not installed / blocked / no helper" are answered by the host as unavailable; everything else is a failure of this attempt
      this.setStatus(want.key, { phase: /not installed|cannot be used|no plugin helper|at most/.test(message) ? "unavailable" : "failed", latencyMs: 0, blockFrames, underruns: previous?.underruns ?? 0, lateBlocks: 0, reason: message });
      return;
    }
    const { node, sessionId } = opened;
    const old = this.records.get(want.key);
    const record: LiveRecord = { key: want.key, kind: want.kind, id: want.id, signature, sessionId, node, effectIds: want.steps.map((s) => s.effectId), sent: new Map(want.steps.map((s) => [s.effectId, stepPayload(s)])), failed: false, stopTimer: null };
    this.records.set(want.key, record);
    this.failedSignatures.delete(want.key);
    graph.setLiveInsert(want.kind, want.id, node);
    if (old) this.teardown(old, false);
    this.setStatus(want.key, { phase: "live", latencyMs: (node.latencyFrames / sampleRate) * 1000, blockFrames: opened.open.blockFrames, underruns: 0, lateBlocks: 0 });
    if (this.playing) node.start(getMasterClock().currentTime);
  }

  private onStats(key: string, underruns: number, lateBlocks: number, latencyFrames: number, blockFrames: number, sampleRate: number): void {
    const current = useLiveInsertState.getState().targets[key];
    if (!current || current.phase === "failed") return;
    const latencyMs = (latencyFrames / sampleRate) * 1000;
    if (current.underruns === underruns && current.lateBlocks === lateBlocks && Math.abs(current.latencyMs - latencyMs) < 0.01) return;
    this.setStatus(key, { ...current, underruns, lateBlocks, latencyMs, blockFrames });
  }

  private onHostStatus(key: string, state: string, reason?: string): void {
    if (state !== "crashed" && state !== "failed") return;
    const record = this.records.get(key);
    if (record) {
      record.failed = true;
      this.failedSignatures.set(key, record.signature);
    }
    const current = useLiveInsertState.getState().targets[key];
    this.setStatus(key, { phase: "failed", latencyMs: current?.latencyMs ?? 0, blockFrames: current?.blockFrames ?? 256, underruns: current?.underruns ?? 0, lateBlocks: current?.lateBlocks ?? 0, reason: reason ?? "the plugin host stopped" });
    console.warn(`[live-insert] ${key} stopped: ${reason ?? state}. It plays dry (time aligned) until playback stops, then the rendered version takes over.`);
  }

  private teardown(record: LiveRecord, unplug: boolean): void {
    if (record.stopTimer) clearTimeout(record.stopTimer);
    if (unplug) getRealtimeAudioGraph().setLiveInsert(record.kind, record.id, null);
    // The old node keeps playing its tail for a moment behind the new one; the graph no longer reaches it.
    record.node.dispose();
    void this.bridge?.liveClose?.(record.sessionId);
  }

  private dispose(record: LiveRecord): void {
    this.records.delete(record.key);
    this.teardown(record, true);
  }

  private watchTransport(graph: ReturnType<typeof getRealtimeAudioGraph>): void {
    if (this.unsubscribe) return;
    this.unsubscribe = graph.onTransport(({ playing, time }) => {
      if (playing) {
        this.playing = true;
        for (const record of this.records.values()) {
          if (record.stopTimer) clearTimeout(record.stopTimer);
          record.stopTimer = null;
          if (!record.failed) record.node.start(time);
        }
      } else if (this.playing) {
        this.playing = false;
        for (const record of this.records.values()) {
          if (record.stopTimer) clearTimeout(record.stopTimer);
          record.stopTimer = setTimeout(() => {
            record.stopTimer = null;
            record.node.stop();
          }, TAIL_SECONDS * 1000);
        }
      }
      this.publishTargets();
    });
  }

  /** Tells the rack preview which targets play live (their stem is not substituted) and whether its background render should wait. */
  private publishTargets(): void {
    const preview = getPluginRackPreview();
    const live = new Set<string>();
    for (const record of this.records.values()) {
      // A crashed insert plays dry until playback stops; only then does the rendered version take over (no cut mid-playback).
      if (!record.failed || this.playing) live.add(record.kind === "master" ? MASTER_RACK_TARGET : record.id);
    }
    preview.setLiveTargets(live);
    const allLive = this.latest ? activePluginRackTargets(this.latest.timeline).every((t) => live.has(t.id) && !this.records.get(keyOf(t.kind, t.id))?.failed) : false;
    preview.setRenderDeferred(this.playing && allLive);
  }

  pushValues(target: string, effectId: string, values: Record<string, number>): void {
    for (const record of this.records.values()) {
      if (record.failed || (record.kind === "master" ? MASTER_RACK_TARGET : record.id) !== target || !record.effectIds.includes(effectId)) continue;
      void this.bridge?.liveSet?.(record.sessionId, effectId, values);
    }
  }

  retry(target: string): void {
    for (const key of [...this.failedSignatures.keys()]) if (key.endsWith(`:${target === MASTER_RACK_TARGET ? "__master__" : target}`)) this.failedSignatures.delete(key);
    for (const record of [...this.records.values()]) if (record.failed && (record.kind === "master" ? MASTER_RACK_TARGET : record.id) === target) this.dispose(record);
    if (this.latest) this.sync(this.latest);
  }

  reopenAll(): void {
    for (const record of [...this.records.values()]) this.dispose(record);
    this.failedSignatures.clear();
    if (this.latest) this.sync(this.latest);
  }
}

let shared: LivePluginInserts | null = null;
export const getLivePluginInserts = (): LivePluginInserts => (shared ??= new LivePluginInserts());
