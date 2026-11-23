import type { RegisteredTool } from "./registry";

/**
 * The per-domain tool groups that are not part of the registry's own source. Each is a dynamic
 * import so the bundler emits it as a chunk of its own (descriptions, JSON schemas and handlers of
 * that domain), keeping the registry chunk under its size budget. The order here is the order the
 * tools are listed in, and must not change without regenerating docs/AGENT-CAPABILITIES.md.
 */
export interface LazyToolGroups {
  readonly exportVideo: RegisteredTool;
  readonly groups: RegisteredTool[];
}

/**
 * Loads the groups in one parallel batch (the browser and Electron fetch the chunks together).
 * Vitest's module runner cannot evaluate a batch of concurrent dynamic imports that share
 * circular core modules (it deadlocks), so under Vitest they load one after another; the result
 * is identical.
 */
async function loadAll<T extends readonly (() => Promise<unknown>)[] | []>(
  loaders: T,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const serial = typeof process !== "undefined" && Boolean(process.env?.VITEST);
  if (!serial) return (await Promise.all(loaders.map((load) => load()))) as never;
  const out: unknown[] = [];
  for (const load of loaders) out.push(await load());
  return out as never;
}

/**
 * Loads every group module and returns a function that reads their exports. Reading is separate on purpose: the bundler may
 * fold a small group into the registry's own chunk (desktop build, experimentalMinChunkSize), where that group's bindings are
 * only initialised after the registry module's top-level await has finished. Awaiting the import is fine then, touching the
 * export ("Cannot access ... before initialization") is not, so the registry reads them on first use instead.
 */
export async function loadLazyToolGroups(): Promise<() => LazyToolGroups> {
  const [
    exportQueue,
    pro,
    interchange,
    trackRack,
    routing,
    loudness,
    colorLib,
    caption,
    textStyle,
    bin,
    channel,
    sequence,
    graphic,
    multicam,
    renderCache,
    still,
    path,
    appState,
    proxy,
    tracking,
    repair,
    effectInstance,
    transition,
    keyframeGraph,
    timeInterpolation,
    vr,
    spectral,
    dereverb,
  ] = await loadAll([
    () => import("./export-queue-tools"),
    () => import("./pro-edit-tools"),
    () => import("./interchange-tools"),
    () => import("./track-audio-rack-tools"),
    () => import("./audio-routing-tools"),
    () => import("./loudness-tools"),
    () => import("./color-library-tools"),
    () => import("./caption-tools"),
    () => import("./text-style-tools"),
    () => import("./bin-tools"),
    () => import("./audio-channel-tools"),
    () => import("./sequence-tools"),
    () => import("./graphic-tools"),
    () => import("./multicam-source-tools"),
    () => import("./render-cache-tools"),
    () => import("./still-export-tools"),
    () => import("./path-tools"),
    () => import("./app-state-tools"),
    () => import("./proxy-tools"),
    () => import("./motion-tracking-tools"),
    () => import("./audio-repair-tools"),
    () => import("./effect-instance-tools"),
    () => import("./transition-tools"),
    () => import("./keyframe-graph-tools"),
    () => import("./time-interpolation-tools"),
    () => import("./vr-tools"),
    () => import("./audio-spectral-tools"),
    () => import("./audio-dereverb-tools"),
  ]);
  return () => ({
    exportVideo: exportQueue.EXPORT_VIDEO_TOOL,
    groups: [
      ...pro.PRO_EDIT_TOOLS,
      ...interchange.INTERCHANGE_TOOLS,
      ...trackRack.TRACK_AUDIO_RACK_TOOLS,
      ...routing.AUDIO_ROUTING_TOOLS,
      ...loudness.LOUDNESS_TOOLS,
      ...colorLib.COLOR_LIBRARY_TOOLS,
      ...caption.CAPTION_TOOLS,
      ...textStyle.TEXT_STYLE_TOOLS,
      ...bin.BIN_TOOLS,
      ...channel.AUDIO_CHANNEL_TOOLS,
      ...sequence.SEQUENCE_TOOLS,
      ...graphic.GRAPHIC_TOOLS,
      ...multicam.MULTICAM_SOURCE_TOOLS,
      ...renderCache.RENDER_CACHE_TOOLS,
      ...exportQueue.EXPORT_QUEUE_TOOLS,
      ...still.STILL_EXPORT_TOOLS,
      ...path.PATH_TOOLS,
      ...appState.APP_STATE_TOOLS,
      ...proxy.PROXY_TOOLS,
      ...tracking.MOTION_TRACKING_TOOLS,
      ...repair.AUDIO_REPAIR_TOOLS,
      ...effectInstance.EFFECT_INSTANCE_TOOLS,
      ...transition.TRANSITION_TOOLS,
      ...keyframeGraph.KEYFRAME_GRAPH_TOOLS,
      ...timeInterpolation.TIME_INTERPOLATION_TOOLS,
      ...vr.VR_TOOLS,
      ...spectral.AUDIO_SPECTRAL_TOOLS,
      ...dereverb.AUDIO_DEREVERB_TOOLS,
    ],
  });
}
