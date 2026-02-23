import React, {
  useCallback,
  useMemo,
  useEffect,
  useState,
  useRef,
} from "react";
import { useProjectStore } from "../../stores/project-store";
import { ChannelStrip } from "./ChannelStrip";
import type { ChannelStripState } from "./types";
import { volumeToDb, formatDb } from "./types";
import { getRealtimeAudioGraph } from "@openreel/core";

export interface AudioMixerProps {
  /** Whether the mixer panel is visible */
  visible?: boolean;
  /** Callback when the mixer is closed */
  onClose?: () => void;
}

/**
 * Master channel component for overall output control
 */
const MasterChannel: React.FC<{
  volume: number;
  peakLevel: number;
  rmsLevel: number;
  onVolumeChange: (volume: number) => void;
}> = ({ volume, peakLevel, rmsLevel, onVolumeChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onVolumeChange(parseFloat(e.target.value));
    },
    [onVolumeChange],
  );

  const dbValue = volumeToDb(volume);
  const levelPercent = Math.min(100, Math.max(0, rmsLevel * 100));
  const peakPercent = Math.min(100, Math.max(0, peakLevel * 100));

  const getColor = (percent: number) => {
    if (percent > 90) return "bg-red-500";
    if (percent > 75) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="flex flex-col items-center gap-2 p-3 bg-gray-900 rounded-lg min-w-[100px] border border-gray-700">
      <div className="text-xs text-gray-300 font-bold">MASTER</div>

      {/* Stereo level meter */}
      <div className="flex gap-1 h-32 w-6">
        <div className="flex-1 bg-gray-800 rounded-sm overflow-hidden relative">
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-75 ${getColor(
              levelPercent,
            )}`}
            style={{ height: `${levelPercent}%` }}
          />
          <div
            className="absolute left-0 right-0 h-0.5 bg-white"
            style={{ bottom: `${peakPercent}%` }}
          />
        </div>
        <div className="flex-1 bg-gray-800 rounded-sm overflow-hidden relative">
          <div
            className={`absolute bottom-0 left-0 right-0 transition-all duration-75 ${getColor(
              levelPercent,
            )}`}
            style={{ height: `${levelPercent}%` }}
          />
          <div
            className="absolute left-0 right-0 h-0.5 bg-white"
            style={{ bottom: `${peakPercent}%` }}
          />
        </div>
      </div>

      {/* Master fader */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-gray-400 font-mono w-12 text-center">
          {formatDb(dbValue)} dB
        </span>
        <input
          type="range"
          min="0"
          max="4"
          step="0.01"
          value={volume}
          onChange={handleChange}
          className="h-24 w-2 appearance-none bg-gray-700 rounded-full cursor-pointer
 [writing-mode:vertical-lr] [direction:rtl]
 [&::-webkit-slider-thumb]:appearance-none
 [&::-webkit-slider-thumb]:w-4
 [&::-webkit-slider-thumb]:h-6
 [&::-webkit-slider-thumb]:bg-orange-500
 [&::-webkit-slider-thumb]:rounded
 [&::-webkit-slider-thumb]:cursor-pointer
 [&::-webkit-slider-thumb]:shadow-md
 [&::-moz-range-thumb]:w-4
 [&::-moz-range-thumb]:h-6
 [&::-moz-range-thumb]:bg-orange-500
 [&::-moz-range-thumb]:rounded
 [&::-moz-range-thumb]:cursor-pointer
 [&::-moz-range-thumb]:border-0"
          aria-label="Master volume fader"
        />
      </div>
    </div>
  );
};

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
  const project = useProjectStore((state) => state.project);
  const muteTrack = useProjectStore((state) => state.muteTrack);
  const soloTrack = useProjectStore((state) => state.soloTrack);

  // Use the same graph as playback so mixer volume affects preview/playback
  const audioGraphRef = useRef<ReturnType<typeof getRealtimeAudioGraph> | null>(null);

  // Local state for master volume and levels
  const [masterVolume, setMasterVolume] = useState(1);
  const [masterPeakLevel, setMasterPeakLevel] = useState(0);
  const [masterRmsLevel, setMasterRmsLevel] = useState(0);

  // Local state for track volumes and pans (stored per-track)
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [trackPans, setTrackPans] = useState<Record<string, number>>({});
  const [trackLevels, setTrackLevels] = useState<
    Record<string, { peak: number; rms: number }>
  >({});

  // Get audio tracks from the timeline (Requirement 20.1) – safe if project/timeline not ready
  const audioTracks = useMemo(() => {
    const tracks = project?.timeline?.tracks ?? [];
    return tracks.filter(
      (track) => track.type === "audio" || track.type === "video",
    );
  }, [project?.timeline?.tracks]);

  useEffect(() => {
    try {
      audioGraphRef.current = getRealtimeAudioGraph();
    } catch {
      audioGraphRef.current = null;
    }
  }, []);

  // Sync initial volume/pan/master from graph when mixer opens (e.g. after playback)
  useEffect(() => {
    if (!visible || !audioGraphRef.current) return;
    const graph = audioGraphRef.current;
    try {
      if (typeof graph.getMasterVolume === "function") {
        setMasterVolume(graph.getMasterVolume());
      }
      if (typeof graph.getTrackVolume === "function" && typeof graph.getTrackPan === "function") {
        setTrackVolumes((prev) => {
          const next = { ...prev };
          audioTracks.forEach((t) => {
            next[t.id] = graph.getTrackVolume(t.id);
          });
          return next;
        });
        setTrackPans((prev) => {
          const next = { ...prev };
          audioTracks.forEach((t) => {
            next[t.id] = graph.getTrackPan(t.id);
          });
          return next;
        });
      }
    } catch {
      // Graph not ready yet
    }
  }, [visible, audioTracks]);

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
      peakLevel: trackLevels[track.id]?.peak ?? 0,
      rmsLevel: trackLevels[track.id]?.rms ?? 0,
    }));
  }, [audioTracks, trackVolumes, trackPans, trackLevels]);

  // Handle volume change (Requirement 20.2) – applies to same graph used for playback
  const handleVolumeChange = useCallback((trackId: string, volume: number) => {
    setTrackVolumes((prev) => ({
      ...prev,
      [trackId]: volume,
    }));
    audioGraphRef.current?.updateTrackVolume(trackId, volume);
  }, []);

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

  // Level metering – based on track volume and mute/solo
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      const newLevels: Record<string, { peak: number; rms: number }> = {};

      audioTracks.forEach((track) => {
        const isAudible =
          !track.muted && (!hasSoloedTracks || track.solo);
        const trackVolume = trackVolumes[track.id] ?? 1;

        if (isAudible && trackVolume > 0) {
          // Calculate levels based on track volume
          const baseLevel = trackVolume * 0.4;
          newLevels[track.id] = {
            peak: Math.min(1, baseLevel * 1.2),
            rms: baseLevel,
          };
        } else {
          newLevels[track.id] = { peak: 0, rms: 0 };
        }
      });

      setTrackLevels(newLevels);

      // Update master levels from active tracks
      const activeLevels = Object.values(newLevels).filter((l) => l.rms > 0);
      if (activeLevels.length > 0) {
        const avgRms =
          activeLevels.reduce((sum, l) => sum + l.rms, 0) / activeLevels.length;
        const maxPeak = Math.max(...activeLevels.map((l) => l.peak));
        setMasterRmsLevel(Math.min(1, avgRms * masterVolume));
        setMasterPeakLevel(Math.min(1, maxPeak * masterVolume));
      } else {
        setMasterRmsLevel(0);
        setMasterPeakLevel(0);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [visible, audioTracks, hasSoloedTracks, masterVolume, trackVolumes]);

  if (!visible) return null;

  return (
    <div
      className="bg-gray-900 border-t border-gray-700 p-4"
      data-testid="audio-mixer"
      role="region"
      aria-label="Audio Mixing Console"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Audio Mixer</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close mixer"
          >
            ✕
          </button>
        )}
      </div>

      {/* Channel strips container */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {/* Track channel strips (Requirement 20.1) */}
        {channels.length > 0 ? (
          channels.map((channel) => (
            <ChannelStrip
              key={channel.trackId}
              channel={channel}
              onVolumeChange={handleVolumeChange}
              onPanChange={handlePanChange}
              onMuteToggle={handleMuteToggle}
              onSoloToggle={handleSoloToggle}
              hasSoloedTracks={hasSoloedTracks}
            />
          ))
        ) : (
          <div className="text-gray-500 text-sm py-8 px-4">
            No audio tracks in timeline. Add audio or video tracks to see
            channel strips.
          </div>
        )}

        {/* Separator */}
        {channels.length > 0 && (
          <div className="w-px bg-gray-700 mx-2 self-stretch" />
        )}

        {/* Master channel */}
        <MasterChannel
          volume={masterVolume}
          peakLevel={masterPeakLevel}
          rmsLevel={masterRmsLevel}
          onVolumeChange={handleMasterVolumeChange}
        />
      </div>

      {/* Status bar */}
      <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <span>
          {channels.length} channel{channels.length !== 1 ? "s" : ""}
          {hasSoloedTracks && (
            <span className="ml-2 text-yellow-500">• Solo active</span>
          )}
        </span>
        <span>
          Sample Rate: {project.settings.sampleRate}Hz | Channels:{" "}
          {project.settings.channels}
        </span>
      </div>
    </div>
  );
};

export default AudioMixer;
