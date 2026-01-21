import React, { useCallback, useState, useEffect } from "react";
import { Music, Zap, Play, Loader2, RefreshCw, Scissors } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import {
  getBeatSyncBridge,
  type BeatSyncState,
} from "../../../bridges/beat-sync-bridge";

interface BeatSyncSectionProps {
  clipId: string;
}

export const BeatSyncSection: React.FC<BeatSyncSectionProps> = ({ clipId }) => {
  const { getClip, getMediaItem, splitClip } = useProjectStore();
  const [beatState, setBeatState] = useState<BeatSyncState>(() =>
    getBeatSyncBridge().getState(),
  );
  const [manualBpm, setManualBpm] = useState<number>(120);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const clip = getClip(clipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;

  useEffect(() => {
    const bridge = getBeatSyncBridge();
    const unsubscribe = bridge.subscribe(setBeatState);
    return unsubscribe;
  }, []);

  const handleAnalyzeBeats = useCallback(async () => {
    if (!mediaItem?.blob) return;

    const bridge = getBeatSyncBridge();
    try {
      await bridge.analyzeAudioFromBlob(mediaItem.blob, clipId);
    } catch (error) {
      console.error("Beat analysis failed:", error);
    }
  }, [mediaItem, clipId]);

  const handleGenerateManualBeats = useCallback(() => {
    if (!clip) return;

    const bridge = getBeatSyncBridge();
    bridge.generateManualBeatMarkers(manualBpm, clip.duration, 0);
  }, [clip, manualBpm]);

  const handleClearBeats = useCallback(() => {
    const bridge = getBeatSyncBridge();
    bridge.clearBeatMarkers();
  }, []);

  const handleAutoCutOnBeats = useCallback(async () => {
    if (!clip || beatState.beatMarkers.length === 0) return;

    const bridge = getBeatSyncBridge();
    const cutPoints = bridge.generateCutPointsForClips([clip], 4);

    for (const cutTime of cutPoints) {
      const absoluteTime = clip.startTime + cutTime;
      if (
        absoluteTime > clip.startTime &&
        absoluteTime < clip.startTime + clip.duration
      ) {
        await splitClip(clipId, absoluteTime);
      }
    }
  }, [clip, clipId, beatState.beatMarkers, splitClip]);

  if (!clip) {
    return (
      <div className="text-center py-4">
        <Music size={24} className="mx-auto text-text-muted mb-2" />
        <p className="text-[10px] text-text-muted">No clip selected</p>
      </div>
    );
  }

  const hasAudio = mediaItem?.type === "audio" || mediaItem?.type === "video";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Music size={14} className="text-primary" />
        <span className="text-xs font-medium text-text-primary">Beat Sync</span>
      </div>

      {hasAudio ? (
        <>
          {beatState.isAnalyzing ? (
            <div className="p-3 bg-background-tertiary rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-[10px] text-text-primary">
                  Analyzing beats...
                </span>
              </div>
              <div className="h-1.5 bg-background-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${beatState.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleAnalyzeBeats}
              className="w-full py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-[11px] font-medium text-primary transition-all flex items-center justify-center gap-2"
            >
              <Zap size={14} />
              Detect Beats from Audio
            </button>
          )}

          {beatState.error && (
            <p className="text-[10px] text-red-400 bg-red-400/10 p-2 rounded">
              {beatState.error}
            </p>
          )}

          {beatState.beatAnalysis && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-text-secondary">
                  Detected BPM
                </span>
                <span className="text-sm font-bold text-green-400">
                  {beatState.beatAnalysis.bpm}
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-text-secondary">
                  Confidence
                </span>
                <span className="text-[10px] text-text-primary">
                  {Math.round(beatState.beatAnalysis.confidence * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">
                  Beat Markers
                </span>
                <span className="text-[10px] text-text-primary">
                  {beatState.beatMarkers.length}
                </span>
              </div>
            </div>
          )}

          {beatState.beatMarkers.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={handleAutoCutOnBeats}
                className="w-full py-2 bg-background-tertiary hover:bg-background-secondary border border-border rounded-lg text-[10px] text-text-primary transition-all flex items-center justify-center gap-2"
              >
                <Scissors size={12} />
                Auto-Cut on Every 4 Beats
              </button>

              <button
                onClick={handleClearBeats}
                className="w-full py-2 bg-background-tertiary hover:bg-red-500/10 border border-border hover:border-red-500/30 rounded-lg text-[10px] text-text-secondary hover:text-red-400 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={12} />
                Clear Beat Markers
              </button>
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full py-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
          >
            {showAdvanced ? "Hide" : "Show"} Manual BPM Settings
          </button>

          {showAdvanced && (
            <div className="p-3 bg-background-tertiary rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary">
                  Manual BPM
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={manualBpm}
                    onChange={(e) =>
                      setManualBpm(parseInt(e.target.value) || 120)
                    }
                    min={60}
                    max={200}
                    className="w-16 px-2 py-1 bg-background-secondary border border-border rounded text-[10px] text-text-primary text-center focus:outline-none focus:border-primary"
                  />
                  <span className="text-[10px] text-text-muted">BPM</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {[80, 100, 120, 140].map((bpm) => (
                  <button
                    key={bpm}
                    onClick={() => setManualBpm(bpm)}
                    className={`py-1.5 rounded text-[9px] transition-colors ${
                      manualBpm === bpm
                        ? "bg-primary text-white"
                        : "bg-background-secondary border border-border text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {bpm}
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerateManualBeats}
                className="w-full py-2 bg-background-secondary hover:bg-background-tertiary border border-border rounded-lg text-[10px] text-text-primary transition-all flex items-center justify-center gap-2"
              >
                <Play size={12} />
                Generate Beat Grid at {manualBpm} BPM
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="p-3 bg-background-tertiary rounded-lg">
          <p className="text-[10px] text-text-muted text-center">
            Select a video or audio clip to analyze beats
          </p>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <p className="text-[9px] text-text-muted">
          Beat detection analyzes audio to find the tempo and beat positions.
          Use it to sync cuts, transitions, or effects to the music.
        </p>
      </div>
    </div>
  );
};

export default BeatSyncSection;
