import React, { useCallback, useMemo, useState } from "react";
import { Captions, Languages, AlertCircle, Loader2 } from "lucide-react";
import {
  initializeTranscriptionService,
  type CaptionAnimationStyle,
  type WhisperTranscriptionProgress,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { OPENREEL_TRANSCRIBE_URL } from "../../../config/api-endpoints";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from "@openreel/ui";

const LANGUAGE_OPTIONS = [
  { code: "none", name: "Auto detect" },
  { code: "en", name: "English" },
  { code: "vi", name: "Vietnamese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "th", name: "Thai" },
];

const TARGET_LANGUAGE_OPTIONS = [
  { code: "none", name: "Original" },
  ...LANGUAGE_OPTIONS.filter((language) => language.code !== "none"),
];

export const AutoCaptionPanel: React.FC = () => {
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const selectedClipIds = useUIStore((state) => state.getSelectedClipIds());

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] =
    useState<WhisperTranscriptionProgress | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("none");
  const [targetLanguage, setTargetLanguage] = useState("none");
  const [animationStyle, setAnimationStyle] =
    useState<CaptionAnimationStyle>("word-highlight");
  const [error, setError] = useState<string | null>(null);
  const [lastCaptionCount, setLastCaptionCount] = useState<number | null>(null);

  const selectedClip = useMemo(() => {
    const clipId = selectedClipIds[0];
    return clipId ? getClip(clipId) : undefined;
  }, [getClip, selectedClipIds]);

  const selectedMedia = selectedClip
    ? getMediaItem(selectedClip.mediaId)
    : undefined;
  const canTranscribe =
    !!selectedClip &&
    !!selectedMedia &&
    (selectedMedia.type === "video" || selectedMedia.type === "audio");

  const handleGenerateCaptions = useCallback(async () => {
    if (!selectedClip || !selectedMedia || isTranscribing) return;

    setError(null);
    setLastCaptionCount(null);
    setIsTranscribing(true);
    setProgress({
      phase: "extracting",
      progress: 0,
      message: "Preparing clip audio...",
    });

    try {
      const transcriptionService = initializeTranscriptionService({
        apiEndpoint: `${OPENREEL_TRANSCRIBE_URL}/transcribe`,
        language: sourceLanguage !== "none" ? sourceLanguage : undefined,
        targetLanguage: targetLanguage !== "none" ? targetLanguage : undefined,
      });

      const subtitles = await transcriptionService.transcribeClip(
        selectedClip,
        selectedMedia,
        setProgress,
      );

      for (const subtitle of subtitles) {
        await addSubtitle({
          ...subtitle,
          animationStyle,
        });
      }

      setLastCaptionCount(subtitles.length);
      setProgress({
        phase: "complete",
        progress: 100,
        message: `Added ${subtitles.length} captions`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caption generation failed");
      setProgress({
        phase: "error",
        progress: 0,
        message: err instanceof Error ? err.message : "Caption generation failed",
      });
    } finally {
      setIsTranscribing(false);
    }
  }, [
    addSubtitle,
    animationStyle,
    isTranscribing,
    selectedClip,
    selectedMedia,
    sourceLanguage,
    targetLanguage,
  ]);

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Captions size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Auto-Caption
          </span>
          <p className="text-[9px] text-text-muted">
            Generate captions from the selected clip
          </p>
        </div>
      </div>

      {!canTranscribe && (
        <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <span className="text-[10px] text-amber-300">
            Select a video or audio clip on the timeline first.
          </span>
        </div>
      )}

      <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Languages size={14} className="text-text-secondary" />
            <span className="text-[10px] text-text-secondary">
              Source Language
            </span>
          </div>
          <Select
            value={sourceLanguage}
            onValueChange={setSourceLanguage}
            disabled={isTranscribing}
          >
            <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {LANGUAGE_OPTIONS.map((language) => (
                <SelectItem key={language.code} value={language.code}>
                  {language.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-secondary">Translate To</span>
          <Select
            value={targetLanguage}
            onValueChange={setTargetLanguage}
            disabled={isTranscribing}
          >
            <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              <SelectGroup>
                <SelectLabel className="text-[10px]">Caption language</SelectLabel>
                {TARGET_LANGUAGE_OPTIONS.map((language) => (
                  <SelectItem key={language.code} value={language.code}>
                    {language.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-secondary">Animation</span>
          <Select
            value={animationStyle}
            onValueChange={(value) =>
              setAnimationStyle(value as CaptionAnimationStyle)
            }
            disabled={isTranscribing}
          >
            <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {CAPTION_ANIMATION_STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  {getAnimationStyleDisplayName(style)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {progress && (
        <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center gap-2">
            {isTranscribing && (
              <Loader2 size={12} className="animate-spin text-primary" />
            )}
            <span className="text-[10px] text-text-primary">
              {progress.message}
            </span>
          </div>
          <div className="h-1.5 bg-background-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progress.phase === "error"
                  ? "bg-red-500"
                  : progress.phase === "complete"
                    ? "bg-green-500"
                    : "bg-primary"
              }`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {lastCaptionCount !== null && !error && (
        <div className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
          <span className="text-[10px] text-green-300">
            Added {lastCaptionCount} captions to the preview.
          </span>
        </div>
      )}

      <button
        onClick={handleGenerateCaptions}
        disabled={!canTranscribe || isTranscribing}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isTranscribing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Captions size={16} />
        )}
        <span className="text-[11px] font-medium">
          {isTranscribing ? "Generating..." : "Generate Captions"}
        </span>
      </button>
    </div>
  );
};

export default AutoCaptionPanel;
