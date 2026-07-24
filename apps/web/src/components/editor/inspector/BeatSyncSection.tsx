import React, { useCallback, useState, useEffect } from "react";
import { Music, Zap, Play, Loader2, RefreshCw, Scissors } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
        <Music size={24} className="mx-auto text-fg-3 mb-2" />
        <Text type="supporting" color="secondary" className="text-[10px] text-fg-3">No clip selected</Text>
      </div>
    );
  }

  const hasAudio = mediaItem?.type === "audio" || mediaItem?.type === "video";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Music size={14} className="text-primary" />
        <span className="text-xs font-medium text-fg">Beat Sync</span>
      </div>

      {hasAudio ? (
        <>
          {beatState.isAnalyzing ? (
            <div className="p-3 bg-bg-2 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-[10px] text-fg">
                  Analyzing beats...
                </span>
              </div>
              <div className="h-1.5 bg-bg-1 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${beatState.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <Button
              label="Detect Beats from Audio"
              variant="ghost"
              icon={<Zap size={14} />}
              onClick={handleAnalyzeBeats}
              className="w-full py-2.5 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg text-[11px] font-medium text-primary transition-all flex items-center justify-center gap-2"
            />
          )}

          {beatState.error && (
            <Text type="supporting" className="text-[10px] text-red-400 bg-red-400/10 p-2 rounded">
              {beatState.error}
            </Text>
          )}

          {beatState.beatAnalysis && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-fg-2">
                  Detected BPM
                </span>
                <span className="text-sm font-bold text-green-400">
                  {beatState.beatAnalysis.bpm}
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-fg-2">
                  Confidence
                </span>
                <span className="text-[10px] text-fg">
                  {Math.round(beatState.beatAnalysis.confidence * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-fg-2">
                  Beat Markers
                </span>
                <span className="text-[10px] text-fg">
                  {beatState.beatMarkers.length}
                </span>
              </div>
            </div>
          )}

          {beatState.beatMarkers.length > 0 && (
            <div className="space-y-2">
              <Button
                label="Auto-Cut on Every 4 Beats"
                variant="ghost"
                icon={<Scissors size={12} />}
                onClick={handleAutoCutOnBeats}
                className="w-full py-2 bg-bg-2 hover:bg-bg-1 border border-border rounded-lg text-[10px] text-fg transition-all flex items-center justify-center gap-2"
              />

              <Button
                label="Clear Beat Markers"
                variant="ghost"
                icon={<RefreshCw size={12} />}
                onClick={handleClearBeats}
                className="w-full py-2 bg-bg-2 hover:bg-red-500/10 border border-border hover:border-red-500/30 rounded-lg text-[10px] text-fg-2 hover:text-red-400 transition-all flex items-center justify-center gap-2"
              />
            </div>
          )}

          <Button
            label={showAdvanced ? "Hide Manual BPM Settings" : "Show Manual BPM Settings"}
            variant="ghost"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full py-1.5 text-[10px] text-fg-3 hover:text-fg-2 transition-colors"
          >
            {showAdvanced ? "Hide" : "Show"} Manual BPM Settings
          </Button>

          {showAdvanced && (
            <div className="p-3 bg-bg-2 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-fg-2">
                  Manual BPM
                </span>
                <div className="flex items-center gap-2">
                  <ToolcraftNumberInputControl
                    label="Manual BPM"
                    isLabelHidden
                    size="sm"
                    value={manualBpm}
                    onChange={(value) => setManualBpm(value || 120)}
                    min={60}
                    max={200}
                    className="w-16 px-2 py-1 bg-bg-1 border border-border rounded text-[10px] text-fg text-center focus:outline-none focus:border-primary"
                  />
                  <span className="text-[10px] text-fg-3">BPM</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1">
                {[80, 100, 120, 140].map((bpm) => (
                  <SelectableCard
                    key={bpm}
                    label={`${bpm} BPM`}
                    isSelected={manualBpm === bpm}
                    onChange={() => setManualBpm(bpm)}
                    onClick={() => setManualBpm(bpm)}
                    padding={1}
                    variant={manualBpm === bpm ? "green" : "muted"}
                    className={`py-1.5 rounded text-[9px] transition-colors ${
                      manualBpm === bpm
                        ? "bg-primary text-white"
                        : "bg-bg-1 border border-border text-fg-2 hover:text-fg"
                    }`}
                  >
                    {bpm}
                  </SelectableCard>
                ))}
              </div>

              <Button
                label={`Generate Beat Grid at ${manualBpm} BPM`}
                variant="ghost"
                icon={<Play size={12} />}
                onClick={handleGenerateManualBeats}
                className="w-full py-2 bg-bg-1 hover:bg-bg-2 border border-border rounded-lg text-[10px] text-fg transition-all flex items-center justify-center gap-2"
              />
            </div>
          )}
        </>
      ) : (
        <div className="p-3 bg-bg-2 rounded-lg">
          <Text type="supporting" color="secondary" className="text-[10px] text-fg-3 text-center">
            Select a video or audio clip to analyze beats
          </Text>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="text-[9px] text-fg-3">
          Beat detection analyzes audio to find the tempo and beat positions.
          Use it to sync cuts, transitions, or effects to the music.
        </Text>
      </div>
    </div>
  );
};

export default BeatSyncSection;
