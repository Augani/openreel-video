import { getChannelLayout, getRealtimeAudioGraph, hasAudioRouting, hasEffectiveTrackAutomation, type AudioBus, type AudioRack, type AudioSend, type ChannelLayout, type Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { getPluginRackPreview } from "./plugin-rack-preview";

/**
 * Mirrors project racks (tracks + master) into the live Web Audio graph.
 * Only racks whose object identity changed are pushed, and the graph applies
 * them incrementally, so a rack edit never rebuilds the playing graph.
 */
export function startAudioRackSync(): () => void {
  const applied = new Map<string, AudioRack | undefined>();
  let appliedMaster: AudioRack | undefined;
  // Buses, output assignment and sends (Audio Track Mixer). Compared by
  // identity so only real edits reach the graph; projects that never used
  // routing never create an AudioContext here.
  let appliedBuses: AudioBus[] | undefined;
  let appliedRouting = new Map<string, readonly [string | undefined, AudioSend[] | undefined, Track["automation"], Track["automationMode"]]>();
  let routingApplied = false;
  let routingGraph: ReturnType<typeof getRealtimeAudioGraph> | null = null;
  // Sequence channel layout (Stereo / 5.1) and where clips and tracks sit in the 5.1 room.
  let appliedLayout: ChannelLayout = "stereo";
  let appliedPanTracks: unknown;
  let layoutGraph: ReturnType<typeof getRealtimeAudioGraph> | null = null;

  // Hosted plugins on tracks and buses: the preview renders their stems in the background and, once a stem is ready, the
  // graph's routing is the one that plays it (synthetic stem tracks for buses). Until then the timeline is the project's own.
  const rackPreview = getPluginRackPreview();
  const sync = () => {
    const project = useProjectStore.getState().project;
    rackPreview.update(project);
    const { settings } = project;
    const timeline = project.timeline;
    const routingTimeline = rackPreview.timelineFor(timeline);
    let graph: ReturnType<typeof getRealtimeAudioGraph> | null = null;
    const ensureGraph = () => (graph ??= getRealtimeAudioGraph());
    // The layout goes first: it rebuilds the track/bus/master nodes, which the racks below then target.
    const layout = getChannelLayout(settings);
    let layoutGraphReplaced = false;
    if (appliedLayout === "5.1" || layout === "5.1") {
      try {
        layoutGraphReplaced = layoutGraph !== null && getRealtimeAudioGraph() !== layoutGraph;
      } catch {
        /* audio unavailable */
      }
    }
    if (layout !== appliedLayout || layoutGraphReplaced || (layout === "5.1" && appliedPanTracks !== timeline.tracks)) {
      const layoutChanged = layout !== appliedLayout;
      appliedLayout = layout;
      appliedPanTracks = timeline.tracks;
      if (layout === "5.1" || layoutGraph !== null) {
        try {
          ensureGraph().setChannelLayout(layout, timeline);
          layoutGraph = ensureGraph();
          // The graph rebuilt its nodes and dropped the scheduled clips: have the preview schedule them again.
          if (layoutChanged && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
          }
        } catch {
          /* audio unavailable (tests, locked-down browsers) */
        }
      }
    }
    const seen = new Set<string>();
    for (const track of timeline.tracks) {
      seen.add(track.id);
      const rack = track.audioRack;
      if (applied.get(track.id) === rack) continue;
      // Do not spin up an AudioContext for projects that never used a rack.
      if (rack === undefined && !applied.has(track.id)) continue;
      applied.set(track.id, rack);
      try {
        ensureGraph().setTrackRack(track.id, rack);
      } catch {
        /* audio unavailable (tests, locked-down browsers) */
      }
    }
    for (const id of [...applied.keys()]) {
      if (!seen.has(id)) applied.delete(id);
    }
    const routing = new Map(routingTimeline.tracks.map((t) => [t.id, [t.output, t.sends, t.automation, t.automationMode] as const]));
    // Playback re-initialises the graph singleton: re-apply routing to the new one.
    let graphReplaced = false;
    if (routingApplied) {
      try {
        graphReplaced = getRealtimeAudioGraph() !== routingGraph;
      } catch {
        /* audio unavailable */
      }
    }
    const routingChanged =
      graphReplaced ||
      appliedBuses !== routingTimeline.audioBuses ||
      routing.size !== appliedRouting.size ||
      [...routing].some(([id, value]) => {
        const prev = appliedRouting.get(id);
        return !prev || prev[0] !== value[0] || prev[1] !== value[1] || prev[2] !== value[2] || prev[3] !== value[3];
      });
    if (routingChanged) {
      const automated = routingTimeline.tracks.some(hasEffectiveTrackAutomation);
      const needed = hasAudioRouting(routingTimeline) || automated || routingApplied;
      appliedBuses = routingTimeline.audioBuses;
      appliedRouting = routing;
      if (needed) {
        routingApplied = hasAudioRouting(routingTimeline) || automated;
        try {
          ensureGraph().setRouting(routingTimeline);
          routingGraph = ensureGraph();
        } catch {
          /* audio unavailable */
        }
      }
    }
    const master = timeline.masterAudioRack;
    if (master !== appliedMaster) {
      appliedMaster = master;
      try {
        ensureGraph().setMasterRack(master);
      } catch {
        /* audio unavailable */
      }
    }
  };

  sync();
  const stopStore = useProjectStore.subscribe(sync);
  const stopPreview = rackPreview.onChange(sync);
  return () => {
    stopStore();
    stopPreview();
  };
}
