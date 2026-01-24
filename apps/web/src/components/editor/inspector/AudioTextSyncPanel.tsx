import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Music, Loader2, AlertCircle, Check, Settings2, Image, Type, Video } from "lucide-react";
import { Button, LabeledSlider } from "@openreel/ui";
import {
  getBeatSyncBridge,
  type BeatSyncState,
  DEFAULT_BEAT_SYNC_CONFIG,
} from "../../../bridges/audio-text-sync-bridge";
import type { SyncMode } from "@openreel/core";

interface BeatSyncPanelProps {
  clipId: string;
}

const TRACK_ICONS: Record<string, React.ReactNode> = {
  video: <Video size={12} />,
  image: <Image size={12} />,
  text: <Type size={12} />,
  graphics: <Type size={12} />,
};

export const AudioTextSyncPanel: React.FC<BeatSyncPanelProps> = ({ clipId }) => {
  const [state, setState] = useState<BeatSyncState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const bridge = useMemo(() => getBeatSyncBridge(), []);

  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState);
    bridge.setSelectedAudioClip(clipId);
    return unsubscribe;
  }, [bridge, clipId]);

  const availableTracks = useMemo(() => {
    return bridge.getAvailableTracks();
  }, [bridge, state?.beatAnalysis]);

  const handleAnalyzeBeats = useCallback(() => {
    bridge.analyzeBeats();
  }, [bridge]);

  const handleToggleTrack = useCallback(
    (trackId: string) => {
      bridge.toggleTrackSelection(trackId);
    },
    [bridge],
  );

  const handleApply = useCallback(async () => {
    await bridge.applySync();
  }, [bridge]);

  const handleUpdateConfig = useCallback(
    (updates: Partial<typeof DEFAULT_BEAT_SYNC_CONFIG>) => {
      bridge.updateConfig(updates);
    },
    [bridge],
  );

  if (!state) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  const {
    isProcessing,
    progress,
    beatAnalysis,
    selectedTrackIds,
    clipsToSync,
    previewTimings,
    config,
    error,
  } = state;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-text-secondary">
        <Music size={14} />
        <span className="text-[10px]">Sync clips to the beat of this audio</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {!beatAnalysis ? (
        <div className="space-y-3">
          {isProcessing && progress ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-primary" />
                <span className="text-[10px] text-text-primary">{progress.message}</span>
              </div>
              <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <Button
              onClick={handleAnalyzeBeats}
              className="w-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
            >
              <Music size={14} className="mr-2" />
              Detect Beats
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg border border-primary/30">
            <div>
              <span className="text-[10px] text-text-secondary block">BPM Detected</span>
              <span className="text-lg font-bold text-primary">{beatAnalysis.bpm}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-text-secondary block">Beats</span>
              <span className="text-sm font-medium text-text-primary">
                {beatAnalysis.beats.length}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[10px] text-text-secondary block">
              Select tracks to sync to beats:
            </span>

            {availableTracks.length === 0 ? (
              <p className="text-[10px] text-text-muted p-3 bg-background-tertiary rounded-lg">
                No other tracks with clips found. Add clips to other tracks first.
              </p>
            ) : (
              <div className="space-y-1">
                {availableTracks.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => handleToggleTrack(track.id)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors ${
                      selectedTrackIds.includes(track.id)
                        ? "bg-primary/20 border border-primary/50"
                        : "bg-background-tertiary border border-transparent hover:border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {TRACK_ICONS[track.type] || <Video size={12} />}
                      <span className="text-[11px] text-text-primary">{track.name}</span>
                    </div>
                    <span className="text-[9px] text-text-muted">
                      {track.clipCount} {track.clipCount === 1 ? "clip" : "clips"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {clipsToSync.length > 0 && (
            <div className="p-2 bg-background-tertiary rounded-lg">
              <span className="text-[9px] text-text-muted">
                {clipsToSync.length} clips will be synced to {beatAnalysis.beats.length} beats
              </span>
            </div>
          )}

          <div className="border-t border-border pt-3">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-2 text-[10px] text-text-secondary hover:text-text-primary mb-3"
            >
              <Settings2 size={12} />
              Sync Settings
            </button>

            {showSettings && (
              <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
                <div>
                  <span className="text-[10px] text-text-secondary block mb-2">Sync Mode</span>
                  <div className="space-y-1">
                    {([
                      { value: "smart", label: "Smart", desc: "Adjust duration to fit nearest beat count" },
                      { value: "one-per-beat", label: "One per Beat", desc: "Each clip gets exactly one beat" },
                      { value: "preserve-duration", label: "Preserve Duration", desc: "Keep original duration, snap start to beat" },
                    ] as const).map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => handleUpdateConfig({ syncMode: mode.value as SyncMode })}
                        className={`w-full text-left p-2 rounded transition-colors ${
                          config.syncMode === mode.value
                            ? "bg-primary/20 border border-primary/50"
                            : "bg-background-secondary border border-transparent hover:border-border"
                        }`}
                      >
                        <span className="text-[10px] text-text-primary block">{mode.label}</span>
                        <span className="text-[9px] text-text-muted">{mode.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">Beat Subdivision</span>
                  <div className="flex gap-1">
                    {([1, 2, 4] as const).map((sub) => (
                      <button
                        key={sub}
                        onClick={() => handleUpdateConfig({ beatSubdivision: sub })}
                        className={`px-2 py-1 text-[9px] rounded transition-colors ${
                          config.beatSubdivision === sub
                            ? "bg-primary text-black"
                            : "bg-background-secondary text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        1/{sub}
                      </button>
                    ))}
                  </div>
                </div>

                <LabeledSlider
                  label="Offset"
                  value={config.offsetMs}
                  onChange={(v) => handleUpdateConfig({ offsetMs: v })}
                  min={-500}
                  max={500}
                  step={10}
                  unit="ms"
                />

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-secondary">Downbeats Only</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleUpdateConfig({ snapToDownbeats: false })}
                      className={`px-2 py-1 text-[9px] rounded transition-colors ${
                        !config.snapToDownbeats
                          ? "bg-primary text-black"
                          : "bg-background-secondary text-text-secondary"
                      }`}
                    >
                      All Beats
                    </button>
                    <button
                      onClick={() => handleUpdateConfig({ snapToDownbeats: true })}
                      className={`px-2 py-1 text-[9px] rounded transition-colors ${
                        config.snapToDownbeats
                          ? "bg-primary text-black"
                          : "bg-background-secondary text-text-secondary"
                      }`}
                    >
                      Downbeats
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {previewTimings.length > 0 && (
            <div className="space-y-2">
              <span className="text-[9px] text-text-muted">Preview:</span>
              <div className="max-h-24 overflow-y-auto bg-background-tertiary rounded-lg p-2 space-y-1">
                {previewTimings.slice(0, 5).map((timing, idx) => (
                  <div
                    key={timing.clipId}
                    className="flex items-center justify-between text-[9px]"
                  >
                    <span className="text-text-muted">Clip {idx + 1}</span>
                    <span className="text-text-primary">
                      {timing.originalStartTime.toFixed(2)}s → {timing.newStartTime.toFixed(2)}s
                    </span>
                  </div>
                ))}
                {previewTimings.length > 5 && (
                  <span className="text-[9px] text-text-muted">
                    ...and {previewTimings.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {progress?.phase === "complete" && (
            <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded-lg border border-green-500/30">
              <Check size={14} className="text-green-400" />
              <span className="text-[10px] text-green-400">{progress.message}</span>
            </div>
          )}

          <Button
            onClick={handleApply}
            disabled={isProcessing || previewTimings.length === 0}
            className="w-full bg-primary hover:bg-primary/80 text-black disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Syncing...
              </>
            ) : (
              `Sync ${previewTimings.length} Clips to Beats`
            )}
          </Button>

          <Button
            onClick={handleAnalyzeBeats}
            variant="outline"
            className="w-full"
          >
            Re-analyze Beats
          </Button>
        </div>
      )}
    </div>
  );
};
