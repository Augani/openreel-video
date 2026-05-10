import React, { useState, useCallback } from "react";
import { Sparkles, Play, Check, Loader2 } from "lucide-react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  getTranscriptionService,
  initializeTranscriptionService,
  type TranscriptWord,
} from "@openreel/core";
import { OPENREEL_TRANSCRIBE_URL } from "../../../config/api-endpoints";
import {
  extractHighlights,
  type HighlightResult,
  type HighlightPreferences,
} from "../../../services/highlight-service";

interface HighlightExtractorPanelProps {
  clipId: string;
}

export const HighlightExtractorPanel: React.FC<HighlightExtractorPanelProps> = ({
  clipId,
}) => {
  const [highlights, setHighlights] = useState<HighlightResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = useProjectStore((s) => s.project);
  const getMediaItem = useProjectStore((s) => s.getMediaItem);
  const setPlayheadPosition = useTimelineStore((s) => s.setPlayheadPosition);

  const [preferences, setPreferences] = useState<HighlightPreferences>({
    targetClipCount: 5,
    minClipDuration: 5,
    maxClipDuration: 60,
    contentType: "video",
  });

  const handleAnalyze = useCallback(async () => {
    if (!project) return;

    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    if (!clip) return;

    const mediaItem = getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) {
      setError("Media not found or not loaded");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setHighlights([]);

    try {
      setPhase("Transcribing audio...");
      setProgress(5);

      const transcriptionService = getTranscriptionService() || initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
      });
      const subtitles = await transcriptionService.transcribeClip(
        clip,
        mediaItem,
        (p) => setProgress(Math.round(p.progress * 20)),
      );

      const transcript: TranscriptWord[] = subtitles.flatMap((sub) =>
        sub.words
          ? sub.words.map((w) => ({ text: w.text, start: w.startTime, end: w.endTime }))
          : [{ text: sub.text, start: sub.startTime, end: sub.endTime }],
      );

      if (transcript.length === 0) {
        throw new Error("No transcript words found");
      }

      setPhase("Decoding audio...");
      setProgress(25);

      const arrayBuffer = await mediaItem.blob.arrayBuffer();
      const audioContext = new OfflineAudioContext(1, 44100, 44100);
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const results = await extractHighlights(
        audioBuffer,
        transcript,
        preferences,
        (phaseName, prog) => {
          setPhase(phaseName);
          setProgress(25 + Math.round(prog * 0.75));
        },
      );

      setHighlights(results);
      setSelected(new Set(results.map((_, i) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsProcessing(false);
      setPhase("");
      setProgress(0);
    }
  }, [clipId, project, getMediaItem, preferences]);

  const handlePreview = useCallback(
    (highlight: HighlightResult) => {
      setPlayheadPosition(highlight.start);
    },
    [setPlayheadPosition],
  );

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-secondary">Clips</label>
          <input
            type="number"
            min={1}
            max={20}
            value={preferences.targetClipCount}
            onChange={(e) =>
              setPreferences((p) => ({ ...p, targetClipCount: parseInt(e.target.value) || 5 }))
            }
            className="w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary"
          />
          <label className="text-[10px] text-text-secondary">Max</label>
          <input
            type="number"
            min={1}
            max={300}
            value={preferences.maxClipDuration}
            onChange={(e) =>
              setPreferences((p) => ({ ...p, maxClipDuration: parseInt(e.target.value) || 60 }))
            }
            className="w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary"
          />
          <span className="text-[10px] text-text-muted">s</span>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:bg-primary/90 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
        >
          {isProcessing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {phase} ({progress}%)
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Find Highlights
            </>
          )}
        </button>

        {error && (
          <p className="text-[10px] text-red-400">{error}</p>
        )}
      </div>

      {highlights.length > 0 && (
        <div className="space-y-1.5">
          {highlights.map((highlight, index) => (
            <div
              key={index}
              className={`p-2 rounded border transition-colors cursor-pointer ${
                selected.has(index)
                  ? "bg-primary/10 border-primary/30"
                  : "bg-background-tertiary border-transparent hover:border-border"
              }`}
              onClick={() => toggleSelect(index)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                      highlight.score >= 8
                        ? "bg-green-500"
                        : highlight.score >= 5
                          ? "bg-yellow-500"
                          : "bg-gray-500"
                    }`}
                  >
                    {highlight.score}
                  </div>
                  <span className="text-[10px] text-text-primary font-medium truncate max-w-[140px]">
                    {highlight.title}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(highlight);
                    }}
                    className="p-1 hover:bg-background-secondary rounded"
                  >
                    <Play size={10} className="text-text-muted" />
                  </button>
                  {selected.has(index) && (
                    <Check size={12} className="text-primary" />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-muted">
                  {formatTime(highlight.start)} - {formatTime(highlight.end)}
                </span>
                <span className="text-[9px] text-text-muted italic truncate max-w-[120px]">
                  {highlight.reason}
                </span>
              </div>
            </div>
          ))}

          <button
            onClick={async () => {
              const selectedHighlights = highlights
                .filter((_, i) => selected.has(i))
                .sort((a, b) => a.start - b.start);
              if (selectedHighlights.length === 0) return;

              const store = useProjectStore.getState();
              const proj = store.project;
              const originalTrack = proj.timeline.tracks.find((t) =>
                t.clips.some((c) => c.id === clipId),
              );
              if (!originalTrack) return;

              const clip = originalTrack.clips.find((c) => c.id === clipId);
              if (!clip) return;

              const clipStart = clip.startTime;
              const clipInPoint = clip.inPoint;

              const splitTimes: number[] = [];
              for (const h of selectedHighlights) {
                const hStartOnTimeline = clipStart + (h.start - clipInPoint);
                const hEndOnTimeline = clipStart + (h.end - clipInPoint);
                splitTimes.push(hStartOnTimeline);
                splitTimes.push(hEndOnTimeline);
              }

              const uniqueSplitTimes = [...new Set(splitTimes)]
                .sort((a, b) => a - b)
                .filter((t) => t > clipStart && t < clipStart + clip.duration);

              for (const splitTime of uniqueSplitTimes) {
                const currentProj = useProjectStore.getState().project;
                const track = currentProj.timeline.tracks.find((t) => t.id === originalTrack.id);
                if (!track) break;

                const clipAtTime = track.clips.find(
                  (c) => c.startTime < splitTime && c.startTime + c.duration > splitTime,
                );
                if (clipAtTime) {
                  await store.splitClip(clipAtTime.id, splitTime);
                }
              }

              const finalProj = useProjectStore.getState().project;
              const finalTrack = finalProj.timeline.tracks.find((t) => t.id === originalTrack.id);
              if (!finalTrack) return;

              const clipsToRemove = finalTrack.clips.filter((c) => {
                const cSourceStart = c.inPoint;
                const cSourceEnd = c.inPoint + c.duration;
                return !selectedHighlights.some(
                  (h) => h.start < cSourceEnd && h.end > cSourceStart,
                );
              });

              for (const c of clipsToRemove.sort((a, b) => b.startTime - a.startTime)) {
                await useProjectStore.getState().rippleDeleteClip(c.id);
              }
            }}
            disabled={selected.size === 0}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
          >
            <Check size={14} />
            Apply {selected.size} Highlight{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
};

export default HighlightExtractorPanel;
