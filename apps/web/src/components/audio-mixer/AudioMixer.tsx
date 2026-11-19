import React, {
  useCallback,
  useMemo,
  useEffect,
  useState,
  useRef,
  memo,
} from "react";
import { useProjectStore } from "../../stores/project-store";
import { ChannelStrip } from "./ChannelStrip";
import type { ChannelStripState } from "./types";
import { volumeToDb, formatDb } from "./types";
import {
  getRealtimeAudioGraph,
  planAddBus,
  planStemsPreset,
  getChannelLayout,
  LAYOUT_LABELS,
  CHANNEL_LAYOUTS,
  type ChannelLayout,
  type AudioBus,
  type AudioRack,
} from "@openreel/core";
import {
  Button,
  Slider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import { setSequenceChannelLayout } from "../../services/surround-audio";

import { ScrollArea, ScrollBar } from "@openreel/ui";
import { Plus, X } from "@/icons/lucide-compat";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  createMixerSignalMeter,
  SILENT_SIGNAL_LEVELS,
  silentLevels,
  type SignalLevels as StereoSignalLevels,
} from "../../services/audio-mixer-meter";
import { MixerLevelMeters } from "./MixerLevelMeters";
import { AudioRackSection } from "./AudioRackSection";
import { LoudnessPanel } from "./LoudnessPanel";
import { BusStrip } from "./BusStrip";
import { commitRoutingPlan } from "./routing-ui";
import { AudioOutputSelect } from "../editor/settings/AudioOutputSelect";
import { exportStemsAsDownloads } from "../../services/audio-stems";
import { toast } from "../../stores/notification-store";
import { createMixerChannelSelector } from "../../services/audio-mixer-channels";

interface AudioMixerProps {
  /** Whether the mixer panel is visible */
  visible?: boolean;
  /** Callback when the mixer is closed */
  onClose?: () => void;
}

/**
 * Master channel component for overall output control
 */
const MasterChannel = memo(function MasterChannel({
  volume,
  levels,
  rack,
  onVolumeChange,
  onVolumeCommit,
}: {
  volume: number;
  levels: StereoSignalLevels;
  rack: AudioRack | undefined;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
}) {
  const dbValue = volumeToDb(volume);
  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-bg-1 rounded-lg min-w-[148px] w-[148px] shrink-0 border border-border" data-testid="master-channel">
      <span className="font-bold text-xs text-fg-2">MASTER</span>

      <MixerLevelMeters levels={levels} label="Master" className="w-6" />

      {/* Master fader */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-fg-muted font-mono w-16 whitespace-nowrap text-center">
          {formatDb(dbValue)} dB
        </span>
        <Slider
          aria-label="Master volume fader"
          aria-valuetext={`${formatDb(dbValue)} dB`}
          min={0}
          max={4}
          step={0.01}
          orientation="vertical"
          value={[volume]}
          onValueChange={([next]) => onVolumeChange(next)}
          onValueCommit={([next]) => onVolumeCommit(next)}
          className="cursor-pointer data-[orientation=vertical]:h-24 [@media(max-height:820px)]:data-[orientation=vertical]:h-16 data-[orientation=vertical]:w-2 [&_[data-slot=slider-track]]:bg-border-strong [&_[data-slot=slider-range]]:bg-transparent [&_[role=slider]]:h-6 [&_[role=slider]]:w-4 [&_[role=slider]]:rounded [&_[role=slider]]:bg-accent [&_[role=slider]]:shadow-md"
        />
      </div>

      <AudioRackSection target="master" label="Master" rack={rack} />
    </div>
  );
});

const NO_BUSES: readonly AudioBus[] = [];

function sameLevels(a: StereoSignalLevels, b: StereoSignalLevels) {
  return a.length === b.length && a.every(
    (value, index) =>
      value.peak === b[index].peak && value.rms === b[index].rms,
  );
}

function sameValues(a: Record<string, number>, b: Record<string, number>) {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(b).every((key) => a[key] === b[key])
  );
}

/**
 * AudioMixer component
 *
 * Displays a mixing console with channel strips for each audio track.
 * Implements audio mixing functionality.
 */
export const AudioMixer: React.FC<AudioMixerProps> = ({
  visible = true,
  onClose,
}) => {
  const selectChannels = useMemo(createMixerChannelSelector, []);
  const selectProjectChannels = useCallback(
    (state: ReturnType<typeof useProjectStore.getState>) =>
      selectChannels(state.project),
    [selectChannels],
  );
  const { tracks: audioTracks, trackIds } = useProjectStore(
    selectProjectChannels,
  );
  const busIdKey = useProjectStore((state) => (state.project.timeline.audioBuses ?? []).map((b) => b.id).join("|"));
  const busIds = useMemo(() => (busIdKey ? busIdKey.split("|") : []), [busIdKey]);
  const projectId = useProjectStore((state) => state.project.id);
  const executor = useProjectStore((state) => state.actionExecutor);
  const sampleRate = useProjectStore(
    (state) => state.project.settings.sampleRate,
  );
  const channelCount = useProjectStore(
    (state) => state.project.settings.channels,
  );
  const channelLayout = useProjectStore((state) => getChannelLayout(state.project.settings));
  const surround = channelLayout === "5.1";
  // Meters of an idle mixer: empty bars for every channel of the mix (six in 5.1).
  const idleLevels = useMemo(() => silentLevels(surround ? 6 : 2), [surround]);
  const muteTrack = useProjectStore((state) => state.muteTrack);
  const soloTrack = useProjectStore((state) => state.soloTrack);
  const setAudioRack = useProjectStore((state) => state.setAudioRack);
  const masterRack = useProjectStore(
    (state) => state.project.timeline.masterAudioRack,
  );
  const trackRacks = useProjectStore(
    (state) => state.project.timeline.tracks,
  );
  const buses = useProjectStore((state) => state.project.timeline.audioBuses) ?? NO_BUSES;
  const [exportingStems, setExportingStems] = useState<number | null>(null);

  // Use the same graph as playback so mixer volume affects preview/playback
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(
    null,
  );

  // Local state for master volume and levels
  const [masterVolume, setMasterVolume] = useState(1);
  const [levels, setLevels] = useState<{
    tracks: Record<string, StereoSignalLevels>;
    buses: Record<string, StereoSignalLevels>;
    master: StereoSignalLevels;
  }>({ tracks: {}, buses: {}, master: SILENT_SIGNAL_LEVELS });
  const playing = useTimelineStore(
    (state) => state.playbackState === "playing",
  );

  // Local state for track volumes and pans (stored per-track)
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [trackPans, setTrackPans] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      audioGraphRef.current = getRealtimeAudioGraph();
    } catch {
      audioGraphRef.current = null;
    }
  }, [projectId, executor]);

  // Re-read fader positions after a rack edit/undo (the rack owns volume/pan).
  const rackSignature = useMemo(
    () =>
      trackRacks
        .map((t) => `${t.id}:${t.audioRack?.volume ?? 1}:${t.audioRack?.pan ?? 0}`)
        .join("|"),
    [trackRacks],
  );

  // After a rack edit or Undo/Redo, follow the rack-owned fader/pan values.
  const prevFaders = useRef<Map<string, string> | null>(null);
  const prevMasterVolume = useRef<number | null>(null);
  useEffect(() => {
    const next = new Map(
      trackRacks.map((t) => [t.id, `${t.audioRack?.volume ?? 1}:${t.audioRack?.pan ?? 0}`]),
    );
    const prev = prevFaders.current;
    prevFaders.current = next;
    if (prev) {
      for (const t of trackRacks) {
        if (prev.get(t.id) === next.get(t.id)) continue;
        setTrackVolumes((v) => ({ ...v, [t.id]: t.audioRack?.volume ?? 1 }));
        setTrackPans((v) => ({ ...v, [t.id]: t.audioRack?.pan ?? 0 }));
      }
    }
    const masterVolume = masterRack?.volume ?? 1;
    if (prevMasterVolume.current !== null && prevMasterVolume.current !== masterVolume) {
      setMasterVolume(masterVolume);
    }
    prevMasterVolume.current = masterVolume;
  }, [rackSignature, trackRacks, masterRack]);

  // Sync initial volume/pan/master from graph when mixer opens (e.g. after playback)
  useEffect(() => {
    if (!visible || !audioGraphRef.current) return;
    const graph = audioGraphRef.current;
    try {
      if (typeof graph.getMasterVolume === "function") {
        setMasterVolume(graph.getMasterVolume());
      }
      if (
        typeof graph.getTrackVolume === "function" &&
        typeof graph.getTrackPan === "function"
      ) {
        setTrackVolumes((prev) => {
          const next = Object.fromEntries(
            trackIds.map((id) => [id, graph.getTrackVolume(id)]),
          );
          return sameValues(prev, next) ? prev : next;
        });
        setTrackPans((prev) => {
          const next = Object.fromEntries(
            trackIds.map((id) => [id, graph.getTrackPan(id)]),
          );
          return sameValues(prev, next) ? prev : next;
        });
      }
    } catch {
      // Graph not ready yet
    }
  }, [visible, trackIds, projectId, executor]);

  // Check if any track has solo enabled (for Requirement 20.4)
  const hasSoloedTracks = useMemo(() => {
    return audioTracks.some((track) => track.solo);
  }, [audioTracks]);

  // Build channel strip states (Requirement 20.1)
  const channels: ChannelStripState[] = useMemo(() => {
    return audioTracks.map((track) => ({
      trackId: track.id,
      trackName: track.name,
      trackType: track.type,
      volume: trackVolumes[track.id] ?? 1,
      pan: trackPans[track.id] ?? 0,
      muted: track.muted,
      solo: track.solo,
      soloSafe: track.soloSafe === true,
      rack: track.audioRack,
      output: track.output,
      sends: track.sends,
      surroundPan: track.surroundPan,
      levels: playing
        ? (levels.tracks[track.id] ?? idleLevels)
        : idleLevels,
    }));
  }, [audioTracks, trackVolumes, trackPans, levels.tracks, playing, idleLevels]);

  // Handle volume change (Requirement 20.2) – applies to same graph used for playback
  const handleVolumeChange = useCallback((trackId: string, volume: number) => {
    setTrackVolumes((prev) => ({
      ...prev,
      [trackId]: volume,
    }));
    audioGraphRef.current?.updateTrackVolume(trackId, volume);
  }, []);

  const commitRackField = useCallback(
    (target: string, rack: AudioRack | undefined, field: "volume" | "pan", value: number) => {
      void setAudioRack(target, { ...(rack ?? { effects: [] }), effects: rack?.effects ?? [], [field]: value });
    },
    [setAudioRack],
  );
  const handleVolumeCommit = useCallback(
    (trackId: string, volume: number) =>
      commitRackField(
        trackId,
        useProjectStore.getState().project.timeline.tracks.find((t) => t.id === trackId)?.audioRack,
        "volume",
        volume,
      ),
    [commitRackField],
  );
  const handlePanCommit = useCallback(
    (trackId: string, pan: number) =>
      commitRackField(
        trackId,
        useProjectStore.getState().project.timeline.tracks.find((t) => t.id === trackId)?.audioRack,
        "pan",
        pan,
      ),
    [commitRackField],
  );
  const handleMasterVolumeCommit = useCallback(
    (volume: number) =>
      commitRackField(
        "master",
        useProjectStore.getState().project.timeline.masterAudioRack,
        "volume",
        volume,
      ),
    [commitRackField],
  );

  // Handle pan change (Requirement 20.3)
  const handlePanChange = useCallback((trackId: string, pan: number) => {
    setTrackPans((prev) => ({
      ...prev,
      [trackId]: pan,
    }));
    audioGraphRef.current?.updateTrackPan(trackId, pan);
  }, []);

  // Handle mute toggle (Requirement 20.5)
  const handleMuteToggle = useCallback(
    async (trackId: string) => {
      const track = audioTracks.find((t) => t.id === trackId);
      if (track) {
        await muteTrack(trackId, !track.muted);
      }
    },
    [audioTracks, muteTrack],
  );

  // Handle solo toggle (Requirement 20.4)
  const handleSoloToggle = useCallback(
    async (trackId: string) => {
      const track = audioTracks.find((t) => t.id === trackId);
      if (track) {
        await soloTrack(trackId, !track.solo);
      }
    },
    [audioTracks, soloTrack],
  );

  // Handle master volume change
  const handleMasterVolumeChange = useCallback((volume: number) => {
    setMasterVolume(volume);
    audioGraphRef.current?.setMasterVolume(volume);
  }, []);

  useEffect(() => {
    const graph = audioGraphRef.current;
    if (!visible || !playing || !graph) return;
    const trackMeters = trackIds.map(
      (id) => [id, createMixerSignalMeter(graph, id)] as const,
    );
    const busMeters = busIds.map(
      (id) => [id, createMixerSignalMeter(graph, undefined, id)] as const,
    );
    const masterMeter = createMixerSignalMeter(graph);
    const update = () => {
      const sampled = trackMeters.map(
        ([id, meter]) => [id, meter.read()] as const,
      );
      const sampledBuses = busMeters.map(
        ([id, meter]) => [id, meter.read()] as const,
      );
      const master = masterMeter.read();
      setLevels((previous) => {
        const busLevels = Object.fromEntries(
          sampledBuses.map(([id, value]) => [
            id,
            previous.buses[id] && sameLevels(previous.buses[id], value) ? previous.buses[id] : value,
          ]),
        );
        const sameBuses =
          Object.keys(previous.buses).length === sampledBuses.length &&
          sampledBuses.every(([id]) => busLevels[id] === previous.buses[id]);
        const tracks = Object.fromEntries(
          sampled.map(([id, value]) => [
            id,
            previous.tracks[id] && sameLevels(previous.tracks[id], value)
              ? previous.tracks[id]
              : value,
          ]),
        );
        const sameTracks =
          Object.keys(previous.tracks).length === sampled.length &&
          sampled.every(([id]) => tracks[id] === previous.tracks[id]);
        const sameMaster = sameLevels(previous.master, master);
        return sameTracks && sameMaster && sameBuses
          ? previous
          : {
              tracks: sameTracks ? previous.tracks : tracks,
              buses: sameBuses ? previous.buses : busLevels,
              master: sameMaster ? previous.master : master,
            };
      });
    };
    update();
    const interval = window.setInterval(update, 50);
    return () => {
      window.clearInterval(interval);
      trackMeters.forEach(([, meter]) => meter.dispose());
      busMeters.forEach(([, meter]) => meter.dispose());
      masterMeter.dispose();
    };
  }, [visible, playing, trackIds, busIds, projectId, executor]);

  const addBus = useCallback(() => {
    void commitRoutingPlan(planAddBus(useProjectStore.getState().project.timeline));
  }, []);
  const addStemBuses = useCallback(() => {
    void commitRoutingPlan(planStemsPreset(useProjectStore.getState().project.timeline));
  }, []);
  const exportStems = useCallback(async () => {
    setExportingStems(0);
    try {
      const stems = await exportStemsAsDownloads({ onProgress: (fraction) => setExportingStems(fraction) });
      toast.success(`Exported ${stems.length} stem${stems.length === 1 ? "" : "s"}: ${stems.map((s) => s.fileName).join(", ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Stem export failed.");
    } finally {
      setExportingStems(null);
    }
  }, []);
  const anyBusSolo = buses.some((b) => b.solo);

  if (!visible) return null;

  return (
    <div
      className="bg-bg-1 p-4"
      data-testid="audio-mixer"
      role="region"
      aria-label="Audio Mixing Console"
    >
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-y-2">
        <span className="whitespace-nowrap text-lg font-semibold text-fg">Audio Mixer</span>
        <div className="ml-3 flex shrink-0 items-center gap-1.5" data-testid="mixer-channel-layout-group">
          <span className="text-xs text-fg-muted" id="mixer-channel-layout-label">Sequence audio</span>
          <Select value={channelLayout} onValueChange={(next) => void setSequenceChannelLayout(next as ChannelLayout)}>
            <SelectTrigger className="h-7 w-[140px] text-xs" aria-labelledby="mixer-channel-layout-label" data-testid="mixer-channel-layout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_LAYOUTS.map((layout) => (
                <SelectItem key={layout} value={layout} className="text-xs" data-testid={`mixer-channel-layout-${layout}`}>
                  {LAYOUT_LABELS[layout]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5" data-testid="mixer-output-device-group">
          <span className="text-xs text-fg-muted">Output</span>
          <AudioOutputSelect compact testId="mixer-audio-output" />
        </div>
        <div className="ml-auto mr-2 flex flex-wrap items-center justify-end gap-1.5" data-testid="mixer-routing-actions">
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={addBus} data-testid="add-bus">
            <Plus size={12} aria-hidden />
            Add bus
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={addStemBuses}
            title="Create Dialogue, Music and FX buses and route tracks by role"
            data-testid="add-stem-buses"
          >
            Dialogue / Music / FX
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={buses.length === 0 || exportingStems !== null}
            title={buses.length === 0 ? "Add a bus and route tracks into it to export stems" : "Export every bus as its own WAV"}
            onClick={() => void exportStems()}
            data-testid="export-stems"
          >
            {exportingStems === null ? "Export stems" : `Exporting ${Math.round(exportingStems * 100)}%`}
          </Button>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            type="button"
            aria-label="Close mixer"
            title="Close mixer"
            className="text-fg-muted hover:text-fg"
          >
            {<X size={16} aria-hidden />}
          </Button>
        )}
      </div>

      {/* Channel strips scroll; the Master strip stays pinned on the right so buses never push it off-screen. */}
      <div className="flex w-full items-stretch gap-2" data-testid="mixer-strips-row">
      <ScrollArea className="min-w-0 flex-1" data-testid="mixer-strips-scroll">
        <div className="flex w-max min-w-full gap-2 pb-3">
          {/* Track channel strips (Requirement 20.1) */}
          {channels.length > 0 ? (
            channels.map((channel) => (
              <ChannelStrip
                key={channel.trackId}
                channel={channel}
                onVolumeChange={handleVolumeChange}
                onPanChange={handlePanChange}
                onVolumeCommit={handleVolumeCommit}
                onPanCommit={handlePanCommit}
                onMuteToggle={handleMuteToggle}
                onSoloToggle={handleSoloToggle}
                hasSoloedTracks={hasSoloedTracks}
                buses={buses}
                surround={surround}
              />
            ))
          ) : (
            <span className="font-normal text-fg-muted text-sm py-8 px-4">
              No audio tracks in timeline. Add audio or video tracks to see
              channel strips.
            </span>
          )}

          {/* Submix buses */}
          {buses.map((bus) => (
            <BusStrip
              key={bus.id}
              bus={bus}
              buses={buses}
              levels={playing ? (levels.buses[bus.id] ?? idleLevels) : idleLevels}
              anySolo={anyBusSolo}
            />
          ))}

        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="w-px shrink-0 self-stretch bg-border-strong" />
      <div className="shrink-0 pb-3">
        <MasterChannel
          volume={masterVolume}
          levels={playing ? levels.master : idleLevels}
          rack={masterRack}
          onVolumeChange={handleMasterVolumeChange}
          onVolumeCommit={handleMasterVolumeCommit}
        />
      </div>
      </div>


      <LoudnessPanel visible={visible} />

      {/* Status bar */}
      <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>
          {channels.length} channel{channels.length !== 1 ? "s" : ""}
          {buses.length > 0 && (
            <span className="ml-2">
              {buses.length} bus{buses.length !== 1 ? "es" : ""}
            </span>
          )}
          {hasSoloedTracks && (
            <span className="ml-2 text-status-warning">• Solo active</span>
          )}
        </span>
        <span>
          Sample Rate: {sampleRate}Hz | Channels: {channelCount}
          {surround ? " (5.1: L R C LFE Ls Rs)" : ""}
        </span>
      </div>
    </div>
  );
};
