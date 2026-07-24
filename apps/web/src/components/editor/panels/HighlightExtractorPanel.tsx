import React, { useState, useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Sparkles, Play, Check, Loader2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { applyHighlightRanges } from "../../../services/highlight-apply";
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
          <Text type="label" color="secondary" className="text-[10px] text-text-secondary">Clips</Text>
          <ToolcraftNumberInputControl
            label="Clips"
            isLabelHidden
            size="sm"
            width={48}
            min={1}
            max={20}
            value={preferences.targetClipCount}
            onChange={(value) =>
              setPreferences((p) => ({ ...p, targetClipCount: value || 5 }))
            }
            className="w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary"
          />
          <Text type="label" color="secondary" className="text-[10px] text-text-secondary">Max</Text>
          <ToolcraftNumberInputControl
            label="Max duration"
            isLabelHidden
            size="sm"
            width={48}
            min={1}
            max={300}
            value={preferences.maxClipDuration}
            onChange={(value) =>
              setPreferences((p) => ({ ...p, maxClipDuration: value || 60 }))
            }
            className="w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary"
          />
          <span className="text-[10px] text-text-muted">s</span>
        </div>

        <Button
          label={
            isProcessing ? `${phase} (${progress}%)` : "Find Highlights"
          }
          icon={
            isProcessing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )
          }
          variant="primary"
          size="md"
          onClick={handleAnalyze}
          isDisabled={isProcessing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:bg-primary/90 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
        />

        {error && (
          <Text type="supporting" className="text-[10px] text-red-400">{error}</Text>
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
                  <IconButton
                    label="Preview highlight"
                    icon={<Play size={10} className="text-text-muted" aria-hidden />}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(highlight);
                    }}
                    className="p-1 hover:bg-background-secondary rounded"
                  />
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

          <Button
            label={`Apply ${selected.size} Highlight${selected.size !== 1 ? "s" : ""}`}
            icon={<Check size={14} aria-hidden />}
            variant="primary"
            size="md"
            onClick={async () => {
              const selectedHighlights = highlights.filter((_, i) => selected.has(i));
              await applyHighlightRanges(
                clipId,
                selectedHighlights.map((h) => ({ start: h.start, end: h.end })),
              );
            }}
            isDisabled={selected.size === 0}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
};

export default HighlightExtractorPanel;
