import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  Music,
  Loader2,
  AlertCircle,
  Check,
  Settings2,
  Image,
  Type,
  Video,
} from "@/icons/lucide-compat";
import { Button, cn, Card, Progress } from "@openreel/ui";




import { PropertySlider } from "./shell/PropertySlider";
import {
  getBeatSyncBridge,
  type BeatSyncState,
  DEFAULT_BEAT_SYNC_CONFIG,
} from "../../../bridges/audio-text-sync-bridge";
import { useProjectStore } from "../../../stores/project-store";
import type { SyncMode } from "@openreel/core";

interface BeatSyncPanelProps {
  clipId: string;
}

const TRACK_ICONS: Record<string, React.ReactNode> = {
  video: <Video size={12} aria-hidden />,
  image: <Image size={12} aria-hidden />,
  text: <Type size={12} aria-hidden />,
  graphics: <Type size={12} aria-hidden />,
};

export const AudioTextSyncPanel: React.FC<BeatSyncPanelProps> = ({ clipId }) => {
  const project = useProjectStore((store) => store.project);
  const [state, setState] = useState<BeatSyncState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const bridge = useMemo(() => getBeatSyncBridge(), []);

  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState);
    bridge.setSelectedAudioClip(clipId);
    return unsubscribe;
  }, [bridge, clipId]);

  useEffect(() => {
    bridge.refreshProject();
  }, [bridge, project]);

  const availableTracks = bridge.getAvailableTracks();

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
        <Loader2 size={20} className="animate-spin text-primary" aria-hidden />
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
    <fieldset disabled={isProcessing} className="space-y-4 min-w-0">
      <div className="flex items-center gap-2 text-fg-2">
        <Music size={14} aria-hidden />
        <span className="text-fg-2 font-normal text-[10px]">
          Trim and arrange video clips in order so each cut lands on a music beat.
        </span>
      </div>

      {error && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-error/10 text-fg p-3 flex items-center gap-2 border border-red-500/30"
        >
          <AlertCircle size={14} className="text-red-400 shrink-0" aria-hidden />
          <span className="font-normal text-[10px] text-red-400">
            {error}
          </span>
        </Card>
      )}

      {!beatAnalysis ? (
        <div className="space-y-3">
          {isProcessing && progress ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-primary" aria-hidden />
                <span className="text-fg font-normal text-[10px]">
                  {progress.message}
                </span>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-right font-mono text-[11px] font-medium text-fg-muted">
                  {Math.round(progress.percent)}%
                </div>
                <Progress
                  aria-label="Beat detection progress"
                  value={progress.percent}
                  className="h-1.5 rounded-full bg-bg-3 [&>div]:rounded-full [&>div]:bg-accent"
                />
              </div>
            </div>
          ) : (
            <Button onClick={handleAnalyzeBeats} type="button" aria-label="Detect Beats" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Music size={14} aria-hidden />}</span>
              <span className="truncate">{"Detect Beats"}</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-3 flex items-center justify-between border border-primary/30"
          >
            <div>
              <span className="text-fg-2 font-normal block text-[10px]">
                BPM Detected
              </span>
              <span className="text-fg font-bold text-lg">
                {beatAnalysis.bpm}
              </span>
            </div>
            <div className="text-right">
              <span className="text-fg-2 font-normal block text-[10px]">
                Beats
              </span>
              <span className="text-fg font-bold text-sm">
                {beatAnalysis.beats.length}
              </span>
            </div>
          </Card>

          <div className="space-y-2">
            <span className="text-fg-2 font-normal block text-[10px]">
              Select tracks to sync to beats:
            </span>

            {availableTracks.length === 0 ? (
              <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
                <span className="text-fg-2 font-normal text-[10px]">
                  No unlocked tracks with eligible clips found. Add video clips to the timeline first.
                </span>
              </Card>
            ) : (
              <div className="space-y-1">
                {availableTracks.map((track) => (
                  <Button variant="ghost" key={track.id} onClick={() => handleToggleTrack(track.id)} type="button" aria-label={`${selectedTrackIds.includes(track.id) ? "Deselect" : "Select"} ${track.name}`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (selectedTrackIds.includes(track.id) ? "" : "border-transparent bg-bg-2 hover:bg-bg-3"), "p-2", `w-full border ${
                      selectedTrackIds.includes(track.id)
                        ? "border-primary/50"
                        : "border-transparent"
                    }`)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {TRACK_ICONS[track.type] || <Video size={12} aria-hidden />}
                        <span className="text-fg font-normal text-[11px]">
                          {track.name}
                        </span>
                      </div>
                      <span className="text-fg-2 font-normal text-[9px]">
                        {track.clipCount} {track.clipCount === 1 ? "clip" : "clips"}
                      </span>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {config.syncMode === "cut-to-beats" && (
            <div className="space-y-2">
              <span className="text-fg-2 font-normal block text-[10px]">
                Cut every
              </span>
              <div className="flex gap-1">
                {([1, 2, 4, 8] as const).map((beats) => (
                  <Button key={beats} onClick={() => handleUpdateConfig({ beatsPerClip: beats })} type="button" aria-label={(`${beats} ${beats === 1 ? "beat" : "beats"}`).trim() || undefined} disabled={(isProcessing)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", ((config.beatsPerClip ?? 4) === beats ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
                    <span className="truncate">{`${beats} ${beats === 1 ? "beat" : "beats"}`}</span>
                  </Button>
                ))}
              </div>
              <span className="text-fg-2 font-normal block text-[10px]">
                Uses each video clip once, starting at its current in point. Music stays in place.
                Choose at least two video clips for a sequence. Undo restores the original timing.
              </span>
            </div>
          )}

          {clipsToSync.length > 0 && (
            <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2">
              <span className="text-fg-2 font-normal text-[9px]">
                {clipsToSync.length} clips will be synced to {beatAnalysis.beats.length} beats
              </span>
            </Card>
          )}

          <div className="border-t border-border pt-3">
            <Button onClick={() => setShowSettings(!showSettings)} type="button" aria-label="Sync Settings" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg mb-3">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Settings2 size={12} aria-hidden />}</span>
              <span className="truncate">{"Sync Settings"}</span>
            </Button>

            {showSettings && (
              <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
                <div>
                  <span className="text-fg-2 font-normal block mb-2 text-[10px]">
                    Sync Mode
                  </span>
                  <div className="space-y-1">
                    {([
                      { value: "cut-to-beats", label: "Cut Video to Beats", desc: "Arrange video clips with a cut every 1, 2, 4, or 8 beats" },
                      { value: "smart", label: "Smart", desc: "Adjust duration to fit nearest beat count" },
                      { value: "one-per-beat", label: "One per Beat", desc: "Each clip gets exactly one beat" },
                      { value: "preserve-duration", label: "Preserve Duration", desc: "Keep original duration, snap start to beat" },
                    ] as const).map((mode) => (
                      <Button variant="ghost" key={mode.value} onClick={() => handleUpdateConfig({ syncMode: mode.value as SyncMode })} type="button" aria-label={`Use ${mode.label} sync mode`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (config.syncMode === mode.value ? "" : "border-border bg-bg-1 hover:bg-bg-2"), "p-2", `w-full border ${
                          config.syncMode === mode.value
                            ? "border-primary/50"
                            : "border-transparent"
                        }`)}>
                        <span className="text-fg font-normal block text-[10px]">
                          {mode.label}
                        </span>
                        <span className="text-fg-2 font-normal text-[9px]">
                          {mode.desc}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>

                {config.syncMode !== "cut-to-beats" && <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-2 font-normal text-[10px]">
                    Beat Subdivision
                  </span>
                  <div className="flex gap-1">
                    {([1, 2, 4] as const).map((sub) => (
                      <Button key={sub} onClick={() => handleUpdateConfig({ beatSubdivision: sub })} type="button" aria-label={(`1/${sub}`).trim() || undefined} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (config.beatSubdivision === sub ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
                        <span className="truncate">{`1/${sub}`}</span>
                      </Button>
                    ))}
                  </div>
                </div>}

                <PropertySlider
                  label="Offset"
                  value={config.offsetMs}
                  onChange={(value: number) => handleUpdateConfig({ offsetMs: value })}
                  min={-500}
                  max={500}
                  step={10}
                  formatValue={(value) => `${Math.round(value)} ms`}
                />

                {config.syncMode !== "cut-to-beats" && <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-2 font-normal text-[10px]">
                    Downbeats Only
                  </span>
                  <div className="flex gap-1">
                    <Button onClick={() => handleUpdateConfig({ snapToDownbeats: false })} type="button" aria-label="All Beats" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (!config.snapToDownbeats ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
                      <span className="truncate">{"All Beats"}</span>
                    </Button>
                    <Button onClick={() => handleUpdateConfig({ snapToDownbeats: true })} type="button" aria-label="Downbeats" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (config.snapToDownbeats ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
                      <span className="truncate">{"Downbeats"}</span>
                    </Button>
                  </div>
                </div>}
              </Card>
            )}
          </div>

          {previewTimings.length > 0 && (
            <div className="space-y-2">
              <span className="text-fg-2 font-normal text-[9px]">
                Preview:
              </span>
              <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 max-h-24 overflow-y-auto space-y-1">
                {previewTimings.slice(0, 5).map((timing, idx) => (
                  <div
                    key={timing.clipId}
                    className="flex items-center justify-between text-[9px]"
                  >
                    <span className="text-fg-2 font-normal text-[9px]">
                      Clip {idx + 1}
                    </span>
                    <span className="text-fg font-normal text-[9px]">
                      {timing.newStartTime.toFixed(2)}s – {(timing.newStartTime + timing.newDuration).toFixed(2)}s
                    </span>
                  </div>
                ))}
                {previewTimings.length > 5 && (
                  <span className="text-fg-2 font-normal text-[9px]">
                    ...and {previewTimings.length - 5} more
                  </span>
                )}
              </Card>
            </div>
          )}

          {progress?.phase === "complete" && (
            <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-2 flex items-center gap-2 border border-green-500/30"
            >
              <Check size={14} className="text-green-400" aria-hidden />
              <span className="font-normal text-[10px] text-green-400">
                {progress.message}
              </span>
            </Card>
          )}

          <Button onClick={handleApply} type="button" aria-label={(isProcessing
                ? "Syncing..."
                : config.syncMode === "cut-to-beats"
                  ? `Apply Beat Cuts to ${previewTimings.length} Clips`
                  : `Sync ${previewTimings.length} Clips to Beats`).trim() || undefined} disabled={(isProcessing || previewTimings.length === 0) || (isProcessing)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
            {(isProcessing) ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" /> : (isProcessing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : undefined) ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isProcessing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : undefined}</span> : null}
            <span className="truncate">{isProcessing
                ? "Syncing..."
                : config.syncMode === "cut-to-beats"
                  ? `Apply Beat Cuts to ${previewTimings.length} Clips`
                  : `Sync ${previewTimings.length} Clips to Beats`}</span>
          </Button>

          <Button onClick={handleAnalyzeBeats} type="button" aria-label="Re-analyze Beats" disabled={(isProcessing)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full">
            <span className="truncate">{"Re-analyze Beats"}</span>
          </Button>
        </div>
      )}
    </fieldset>
  );
};
