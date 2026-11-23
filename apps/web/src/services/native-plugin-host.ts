import { create } from "zustand";
import {
  NATIVE_PLUGIN_EFFECT_TYPE,
  findNativePluginEffect,
  findRackOwner,
  planAddRackPlugin,
  planClearRackParameterKeyframes,
  planKeyframeRackParameter,
  planMoveRackPlugin,
  planRemoveRackPlugin,
  planSetRackLivePreview,
  planUpdateRackPlugin,
  getRealtimeAudioGraph,
  nativePluginKeyframeProperty,
  planAddNativePluginAction,
  planRemoveNativePluginAction,
  planUpdateNativePluginAction,
  readNativePluginParams,
  type Action,
  type Clip,
  type NativePluginDescriptor,
  type NativePluginParameter,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { toast } from "../stores/notification-store";
import "./native-plugin-backend";

/**
 * Hosted audio plugins from the editor's side: the scanned plugin list, describing a plugin's parameters, adding a plugin to
 * a clip, editing its values, keyframing parameters (ordinary clip keyframes) and opening the plugin's own window. Every edit is
 * an ordinary undoable action; the plugin code itself only ever runs in the main process's helper.
 */

export interface NativePluginHostState {
  readonly available: boolean;
  readonly scanning: boolean;
  readonly scanned: boolean;
  readonly plugins: readonly NativePluginDescriptor[];
  readonly helperError: string | null;
  readonly searchPaths: readonly string[];
  readonly scanProgress: { done: number; total: number } | null;
  /** Latest preview render of any hosted plugin chain (the jobs are keyed by decoded source, not clip). */
  readonly render: { state: "idle" | "running" | "failed"; fraction: number; error?: string };
}

export const useNativePluginHost = create<NativePluginHostState>(() => ({
  available: typeof window !== "undefined" && !!window.openreel?.plughost,
  scanning: false,
  scanned: false,
  plugins: [],
  helperError: null,
  searchPaths: [],
  scanProgress: null,
  render: { state: "idle", fraction: 0 },
}));

const bridge = () => window.openreel?.plughost;
const store = () => useProjectStore.getState();

export async function scanNativePlugins(force = false): Promise<void> {
  const plughost = bridge();
  if (!plughost) return;
  useNativePluginHost.setState({ scanning: true, scanProgress: null });
  const off = plughost.onScanProgress((progress) => useNativePluginHost.setState({ scanProgress: progress }));
  try {
    const result = await plughost.scan(force);
    useNativePluginHost.setState({
      plugins: result.plugins,
      helperError: result.helperAvailable ? null : (result.helperError ?? "No plugin helper is available."),
      searchPaths: [...result.auSearchPaths, ...result.searchedVst3],
      scanned: true,
    });
  } catch (error) {
    useNativePluginHost.setState({ helperError: error instanceof Error ? error.message : String(error), scanned: true });
  } finally {
    off();
    useNativePluginHost.setState({ scanning: false, scanProgress: null });
  }
}

export async function unblockNativePlugin(id: string): Promise<void> {
  await bridge()?.unblock(id);
  getRealtimeAudioGraph().getNativePluginCache().clearFailures();
  await scanNativePlugins(true);
}

const describeCache = new Map<string, Promise<{ latencySamples: number; parameters: NativePluginParameter[]; state: string | null }>>();

/** Parameters, latency and state of a plugin (cached per plugin + state chunk). */
export function describeNativePlugin(pluginId: string, state?: string): Promise<{ latencySamples: number; parameters: NativePluginParameter[]; state: string | null }> {
  const key = `${pluginId}|${state ?? ""}`;
  let pending = describeCache.get(key);
  if (!pending) {
    pending = (async () => {
      const result = await bridge()?.describe(pluginId, state);
      if (!result) throw new Error("Plugin hosting needs the OpenReel desktop app.");
      if (!result.ok) throw new Error(result.message);
      return { latencySamples: result.latencySamples, parameters: result.parameters, state: result.state };
    })();
    describeCache.set(key, pending);
    pending.catch(() => describeCache.delete(key));
  }
  return pending;
}

const findClip = (clipId: string): Clip | undefined => store().getClip(clipId) ?? undefined;
const invalidatePreview = () => window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));

async function run(action: Action): Promise<void> {
  const result = await store().executeAction(action);
  if (!result.success) throw new Error(result.error?.message ?? `The ${action.type} edit could not be applied.`);
}

export async function addNativePluginToClip(clipId: string, plugin: NativePluginDescriptor): Promise<string | null> {
  const clip = findClip(clipId);
  if (!clip) return null;
  const effectId = `native-plugin-${crypto.randomUUID()}`;
  const action = planAddNativePluginAction(clip, plugin, { actionId: crypto.randomUUID(), effectId });
  if (!action) {
    toast.warning("Plugins", "This clip already has the maximum number of plugins.");
    return null;
  }
  await run(action);
  invalidatePreview();
  return effectId;
}

export async function updateNativePlugin(clipId: string, effectId: string, patch: { state?: string; values?: Record<string, number>; enabled?: boolean; latencySamples?: number }): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planUpdateNativePluginAction(clip, effectId, patch, { actionId: crypto.randomUUID() });
  if (!action) return true;
  await run(action);
  invalidatePreview();
  return true;
}

export async function removeNativePluginFromClip(clipId: string, effectId: string): Promise<boolean> {
  const clip = findClip(clipId);
  if (!clip) return false;
  const action = planRemoveNativePluginAction(clip, effectId, { actionId: crypto.randomUUID() });
  if (!action) return false;
  const history = store().actionExecutor.getHistory();
  store().beginHistoryGroup("Remove plugin");
  try {
    await run(action);
    // The plugin's keyframes go with it, in the same undo step.
    const prefix = nativePluginKeyframeProperty(effectId, "");
    const rest = (findClip(clipId)?.keyframes ?? []).filter((keyframe) => !keyframe.property.startsWith(prefix));
    if (rest.length !== (findClip(clipId)?.keyframes ?? []).length) store().updateClipKeyframes(clipId, rest);
  } finally {
    if (history.getCurrentGroupId()) store().endHistoryGroup();
    invalidatePreview();
  }
  return true;
}

/** Preview-only dry/wet A/B for the plugin (the export always includes it). */
export function setNativePluginPreviewBypass(clipId: string, effectId: string, bypassed: boolean): boolean {
  const ok = store().setAudioEffectPreviewBypass(clipId, effectId, bypassed);
  invalidatePreview();
  return ok;
}

export const isNativePluginPreviewBypassed = (clip: Clip | undefined, effectId: string): boolean => findNativePluginEffect(clip, effectId)?.metadata?.previewBypass === true;

/** Adds (or updates) a keyframe for a plugin parameter at the playhead, through the ordinary clip keyframes. Returns false when the playhead is outside the clip. */
export function keyframeNativePluginParameter(clipId: string, effectId: string, key: string, value: number): boolean {
  const clip = findClip(clipId);
  if (!clip) return false;
  const property = nativePluginKeyframeProperty(effectId, key);
  const local = useTimelineStore.getState().playheadPosition - clip.startTime;
  if (local < 0 || local > clip.duration) return false;
  const existing = clip.keyframes ?? [];
  const at = existing.find((keyframe) => keyframe.property === property && Math.abs(keyframe.time - local) < 0.01);
  const next = at
    ? existing.map((keyframe) => (keyframe === at ? { ...keyframe, value } : keyframe))
    : [...existing, { id: `kf-${crypto.randomUUID()}`, time: local, property, value, easing: "linear" as const }].sort((a, b) => a.time - b.time);
  store().updateClipKeyframes(clipId, next);
  invalidatePreview();
  return true;
}

export const clearNativePluginParameterKeyframes = (clipId: string, effectId: string, key: string): void => {
  const clip = findClip(clipId);
  if (!clip) return;
  const property = nativePluginKeyframeProperty(effectId, key);
  store().updateClipKeyframes(clipId, (clip.keyframes ?? []).filter((keyframe) => keyframe.property !== property));
  invalidatePreview();
};

/* ------------------------------------------------------------------ */
/* Track and bus racks (the Audio Track Mixer's plugin slots)          */
/* ------------------------------------------------------------------ */

const rackOwner = (target: string) => findRackOwner(store().project.timeline, target)?.owner;

export async function addNativePluginToRack(target: string, plugin: NativePluginDescriptor): Promise<string | null> {
  const owner = rackOwner(target);
  if (!owner) return null;
  const effectId = `native-plugin-${crypto.randomUUID()}`;
  const action = planAddRackPlugin(owner, plugin, { actionId: crypto.randomUUID(), effectId });
  if (!action) {
    toast.warning("Plugins", "This track, bus or master already has the maximum number of plugins.");
    return null;
  }
  await run(action);
  return effectId;
}

export async function updateRackNativePlugin(target: string, effectId: string, patch: { state?: string; values?: Record<string, number>; enabled?: boolean; latencySamples?: number }): Promise<boolean> {
  const owner = rackOwner(target);
  if (!owner) return false;
  const action = planUpdateRackPlugin(owner, effectId, patch, { actionId: crypto.randomUUID() });
  if (action) await run(action);
  return true;
}

/** Switches a rack's preview between live streaming and the cached render: one undo step (the export is unaffected either way). */
export async function setRackLivePreview(target: string, live: boolean): Promise<boolean> {
  const owner = rackOwner(target);
  const action = owner ? planSetRackLivePreview(owner, live, { actionId: crypto.randomUUID() }) : null;
  if (!action) return false;
  await run(action);
  return true;
}

/** Removes the plugin and its keyframes: one undo step. */
export async function removeRackNativePlugin(target: string, effectId: string): Promise<boolean> {
  const owner = rackOwner(target);
  const action = owner ? planRemoveRackPlugin(owner, effectId, { actionId: crypto.randomUUID() }) : null;
  if (!action) return false;
  await run(action);
  return true;
}

export async function moveRackNativePlugin(target: string, effectId: string, toIndex: number): Promise<boolean> {
  const owner = rackOwner(target);
  const action = owner ? planMoveRackPlugin(owner, effectId, toIndex, { actionId: crypto.randomUUID() }) : null;
  if (!action) return false;
  await run(action);
  return true;
}

/** Adds (or updates) a keyframe of a rack plugin parameter at the playhead: one undo step. False when the playhead is before the timeline start. */
export async function keyframeRackNativeParameter(target: string, effectId: string, key: string, value: number, time = useTimelineStore.getState().playheadPosition): Promise<boolean> {
  const owner = rackOwner(target);
  const action = owner ? planKeyframeRackParameter(owner, effectId, key, time, value, { actionId: crypto.randomUUID(), keyframeId: `kf-${crypto.randomUUID()}` }) : null;
  if (!action) return false;
  await run(action);
  return true;
}

export async function clearRackNativeParameterKeyframes(target: string, effectId: string, key: string): Promise<boolean> {
  const owner = rackOwner(target);
  const action = owner ? planClearRackParameterKeyframes(owner, effectId, key, { actionId: crypto.randomUUID() }) : null;
  if (!action) return false;
  await run(action);
  return true;
}

const uiSessions = new Map<string, { clipId?: string; rackTarget?: string; effectId: string }>();
let uiListening = false;

function listenForUiEvents(): void {
  if (uiListening) return;
  const plughost = bridge();
  if (!plughost) return;
  uiListening = true;
  plughost.onUiEvent((event) => {
    const target = uiSessions.get(event.sessionId);
    if (!target) return;
    if (event.type === "state" && event.state) {
      // The window closed: its final state chunk and parameter values become ONE undoable edit.
      const values: Record<string, number> = {};
      for (const p of event.parameters ?? []) values[p.key] = p.value;
      if (target.rackTarget) void updateRackNativePlugin(target.rackTarget, target.effectId, { state: event.state, values });
      else if (target.clipId) void updateNativePlugin(target.clipId, target.effectId, { state: event.state, values });
    }
    if (event.type === "closed" || event.type === "error") {
      uiSessions.delete(event.sessionId);
      if (event.type === "error") toast.warning("Plugin window", event.message ?? "The plugin window stopped.");
    }
  });
}

/** Opens the plugin's own editor window (a separate process). Returns the session id, or null with a toast when it could not open. */
export async function openNativePluginWindow(clipId: string, effectId: string): Promise<string | null> {
  const plughost = bridge();
  const effect = findNativePluginEffect(findClip(clipId), effectId);
  if (!plughost || !effect) return null;
  listenForUiEvents();
  const params = readNativePluginParams(effect);
  const result = await plughost.openUi({ pluginId: params.pluginId, title: params.name, ...(params.state ? { state: params.state } : {}), values: params.values });
  if (!result.ok) {
    toast.warning("Plugin window", result.message);
    return null;
  }
  uiSessions.set(result.sessionId, { clipId, effectId });
  return result.sessionId;
}

/** Opens the window of a plugin on a track or bus rack; closing it returns the state chunk as one undoable edit. */
export async function openRackNativePluginWindow(target: string, effectId: string): Promise<string | null> {
  const plughost = bridge();
  const effect = rackOwner(target)?.pluginRack?.plugins.find((plugin) => plugin.id === effectId);
  if (!plughost || !effect) return null;
  listenForUiEvents();
  const params = readNativePluginParams(effect);
  const result = await plughost.openUi({ pluginId: params.pluginId, title: params.name, ...(params.state ? { state: params.state } : {}), values: params.values });
  if (!result.ok) {
    toast.warning("Plugin window", result.message);
    return null;
  }
  uiSessions.set(result.sessionId, { rackTarget: target, effectId });
  return result.sessionId;
}

export const closeNativePluginWindow = (sessionId: string): Promise<boolean> | undefined => bridge()?.closeUi(sessionId);

export const isNativePluginEffectType = (type: string): boolean => type === NATIVE_PLUGIN_EFFECT_TYPE;

let wired = false;

/** Shows render progress and failures (the preview's cached jobs) in the inspector. Idempotent. */
export function watchNativePluginRenders(): void {
  if (wired) return;
  wired = true;
  getRealtimeAudioGraph().getNativePluginCache().onStatus((_buffer, status) => {
    useNativePluginHost.setState({ render: status.state === "ready" ? { state: "idle", fraction: 1 } : { state: status.state === "failed" ? "failed" : status.state === "idle" ? "idle" : "running", fraction: status.fraction, ...(status.error ? { error: status.error } : {}) } });
  });
}
