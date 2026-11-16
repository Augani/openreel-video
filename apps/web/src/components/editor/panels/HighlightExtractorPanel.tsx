import {
  Input as ShadcnNumericInput,
  cn as numericCn,
  Button,
} from "@openreel/ui";
import { useNumericDraft } from "../inspector/shell/useNumericDraft";
import React, { useState, useCallback } from "react";




import { Sparkles, Play, Check, Loader2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { applyHighlightRanges } from "../../../services/highlight-apply";
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
      setPhase("Decoding audio...");
      setProgress(10);

      const arrayBuffer = await mediaItem.blob.arrayBuffer();
      const audioContext = new OfflineAudioContext(1, 44100, 44100);
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const results = await extractHighlights(
        audioBuffer,
        [],
        preferences,
        (phaseName, prog) => {
          setPhase(phaseName);
          setProgress(Math.round(prog));
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

  const numericField1 = useNumericDraft({value: preferences.maxClipDuration, onChange: (value) =>
              setPreferences((p) => ({ ...p, maxClipDuration: value || 60 })), min: 1, max: 300, step: 1});
  const numericField0 = useNumericDraft({value: preferences.targetClipCount, onChange: (value) =>
              setPreferences((p) => ({ ...p, targetClipCount: value || 5 })), min: 1, max: 20, step: 1});
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-normal text-[10px] text-text-secondary">Clips</span>
          <ShadcnNumericInput
            {...numericField0}
            type="number"
            inputMode="decimal"
            aria-label={"Clips"}
            min={1}
            max={20}
            step={1}
            disabled={false}
            style={{ width: 48 }}
            className={numericCn(
              "h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 font-mono text-[13px] font-medium tabular-nums text-fg-2 md:text-[13px]",
              "h-7 text-[12px] md:text-[12px]",
              "w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary md:text-[10px]",
            )}
          />
          <span className="font-normal text-[10px] text-text-secondary">Max</span>
          <ShadcnNumericInput
            {...numericField1}
            type="number"
            inputMode="decimal"
            aria-label={"Max duration"}
            min={1}
            max={300}
            step={1}
            disabled={false}
            style={{ width: 48 }}
            className={numericCn(
              "h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 font-mono text-[13px] font-medium tabular-nums text-fg-2 md:text-[13px]",
              "h-7 text-[12px] md:text-[12px]",
              "w-12 px-1 py-0.5 text-[10px] bg-background-secondary border border-border rounded text-text-primary md:text-[10px]",
            )}
          />
          <span className="text-[10px] text-text-muted">s</span>
        </div>

        <Button onClick={handleAnalyze} type="button" aria-label={(isProcessing ? `${phase} (${progress}%)` : "Find Highlights").trim() || undefined} disabled={(isProcessing)} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none h-8 w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary hover:bg-primary/90 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isProcessing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}</span>
          <span className="truncate">{isProcessing ? `${phase} (${progress}%)` : "Find Highlights"}</span>
        </Button>

        {error && (
          <span className="font-normal text-[10px] text-red-400">{error}</span>
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
                  <Button variant="ghost" size="icon-sm" onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(highlight);
                    }} type="button" aria-label="Preview highlight" title="Preview highlight" className="inline-flex shrink-0 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:text-fg p-1 hover:bg-background-secondary rounded">
                    {<Play size={10} className="text-text-muted" aria-hidden />}
                  </Button>
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

          <Button onClick={async () => {
              const selectedHighlights = highlights.filter((_, i) => selected.has(i));
              await applyHighlightRanges(
                clipId,
                selectedHighlights.map((h) => ({ start: h.start, end: h.end })),
              );
            }} type="button" aria-label={(`Apply ${selected.size} Highlight${selected.size !== 1 ? "s" : ""}`).trim() || undefined} disabled={(selected.size === 0)} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none h-8 w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-[11px] font-medium transition-colors disabled:opacity-50">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Check size={14} aria-hidden />}</span>
            <span className="truncate">{`Apply ${selected.size} Highlight${selected.size !== 1 ? "s" : ""}`}</span>
          </Button>
        </div>
      )}
    </div>
  );
};
