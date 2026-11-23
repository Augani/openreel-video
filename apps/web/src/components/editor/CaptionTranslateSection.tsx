import { useEffect, useRef, useState } from "react";
import type { CaptionTranslationProgress } from "@openreel/core";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { toast } from "../../stores/notification-store";
import { detectTranslator, languageName, makeTranslator, type TranslatorAvailability } from "../../services/caption-translator";
import { translateCaptionTrackCommand } from "../../services/transcript-commands";

export const TRANSLATION_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "nl", "sv", "pl", "tr", "ru", "uk", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh", "zh-Hant",
] as const;

interface Props {
  /** Source track id ("" is the default track). */
  trackId: string;
  trackLanguage?: string;
  cueCount: number;
  onTranslated: (trackId: string) => void;
}

/** Translate the active caption track into a new track in another language. */
export function CaptionTranslateSection({ trackId, trackLanguage, cueCount, onTranslated }: Props) {
  const [target, setTarget] = useState("es");
  const [source, setSource] = useState(trackLanguage ?? "");
  const [availability, setAvailability] = useState<TranslatorAvailability | null>(null);
  const [progress, setProgress] = useState<CaptionTranslationProgress | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = progress !== null;

  useEffect(() => setSource(trackLanguage ?? ""), [trackLanguage, trackId]);

  useEffect(() => {
    let live = true;
    setAvailability(null);
    void detectTranslator({ sourceLanguage: source.trim() || undefined, targetLanguage: target }).then((a) => {
      if (live) setAvailability(a);
    });
    return () => {
      live = false;
    };
  }, [source, target]);

  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    if (!availability || availability.engine === null) return;
    const abort = new AbortController();
    controller.current = abort;
    setProgress({ done: 0, total: cueCount });
    setDownload(null);
    try {
      const translator = makeTranslator(availability.engine, {
        signal: abort.signal,
        sourceLanguage: source.trim() || undefined,
        onDownloadProgress: setDownload,
      });
      const outcome = await translateCaptionTrackCommand({
        sourceTrackId: trackId,
        targetLanguage: target,
        translator: { translate: (texts, o) => translator.translate(texts, { ...o, sourceLanguage: o.sourceLanguage ?? (source.trim() || undefined) }) },
        signal: abort.signal,
        onProgress: setProgress,
      });
      if (outcome.success && outcome.trackId) {
        toast.success(`Translated ${outcome.added} captions to ${languageName(target)}`, "The translation is kept out of the picture so languages do not overlap. Use Show this track in the picture to display it. Undo removes the new track.");
        onTranslated(outcome.trackId);
      } else if (outcome.cancelled) {
        toast.info("Translation cancelled", "Nothing was added.");
      } else {
        toast.error("Translation failed", outcome.message);
      }
    } catch (error) {
      toast.error("Translation failed", error instanceof Error ? error.message : undefined);
    } finally {
      controller.current = null;
      setProgress(null);
      setDownload(null);
    }
  };

  const unavailable = availability?.state === "unavailable" ? availability.reason : null;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section aria-label="Caption translation" className="space-y-1.5 rounded-md border border-border bg-bg-1 p-2">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-2">
        <Input
          aria-label="Source language"
          placeholder="From (en…)"
          value={source}
          disabled={running}
          onChange={(e) => setSource(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 w-20 shrink-0 text-[11px]"
        />
        <span aria-hidden>→</span>
        <Select value={target} onValueChange={setTarget} disabled={running}>
          <SelectTrigger aria-label="Target language" className="h-7 min-w-0 flex-1 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSLATION_LANGUAGES.map((code) => (
              <SelectItem key={code} value={code}>
                {languageName(code)} ({code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {unavailable ? (
        <p role="status" data-testid="translate-unavailable" className="text-[11px] text-fg-3">
          {unavailable}
        </p>
      ) : (
        <p className="text-[10px] text-fg-3" data-testid="translate-engine">
          {availability && availability.state !== "unavailable" ? `Translator: ${availability.engine === "ai" ? "AI model" : "Browser"} · ${availability.label}` : "Checking translators…"}
        </p>
      )}
      {!unavailable && availability && availability.state !== "unavailable" ? (
        <p className="text-[10px] text-fg-3" data-testid="translate-privacy">
          {availability.engine === "ai"
            ? "Pressing Translate sends this track's caption text to your connected AI provider. Nothing is sent before that."
            : "Runs on this device. No caption text leaves it."}
        </p>
      ) : null}
      {running ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-3" aria-hidden>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-fg-3">
            <span data-testid="translate-progress">
              {download !== null && download < 1
                ? `Downloading language pack ${Math.round(download * 100)}%`
                : `${progress?.done ?? 0} / ${progress?.total ?? 0} captions`}
            </span>
            <Button type="button" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => controller.current?.abort()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          className="h-7 w-full text-[11px]"
          disabled={!availability || availability.engine === null || target === source.trim() || cueCount === 0}
          onClick={() => void start()}
        >
          Translate to {languageName(target)}
        </Button>
      )}
    </section>
  );
}
