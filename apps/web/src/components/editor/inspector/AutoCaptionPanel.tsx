import { Switch, Button, Card, Progress, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";
import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, Download, Languages, Loader2, Sparkles } from "@/icons/lucide-compat";
import { WHISPER_MODELS, isWhisperModelKey } from "../../../workers/whisper-models";
import { CaptionStyleCards } from "./CaptionStyleCards";
import { useAutoCaptions, CAPTION_STYLE_PRESETS, WHISPER_LANGUAGES, type AutoCaptionControls, type AutoCaptionOptions } from "./useAutoCaptions";
import { useT } from "@openreel/i18n/react";
export { CAPTION_STYLE_PRESETS, WHISPER_LANGUAGES } from "./useAutoCaptions";

export function AutoCaptionPanel(props: AutoCaptionOptions) {
  const controls = useAutoCaptions(props);
  return <AutoCaptionControlsPanel controls={controls}/>;
}
export function AutoCaptionControlsPanel({ controls }: { controls: AutoCaptionControls }) {
  const t = useT();
  const transcribeLabel = controls.sourceCount > 1 ? `Transcribe ${controls.sourceCount} Clips` : "Transcribe Selected Clip";
  const { workerState, isTranscribing, isAdding, mutationBlocked, progress, progressMessage, selectedLanguage, setSelectedLanguage,
    selectedStyle, setSelectedStyle, selectedModel, handleModelChange, handlePrepareModel, handleTranscribe,
    handleAddToTimeline, modelStatus, segments, error, canTranscribe } = controls;
  const [modelOpen, setModelOpen] = useState(false);
  const modelExpanded = modelOpen || workerState === "loading";
  const [segmentPage, setSegmentPage] = useState(1);
  useEffect(() => { setSegmentPage(1); }, [segments]);
  const segmentPageCount = Math.max(1, Math.ceil(segments.length / 50));
  const visibleSegmentPage = Math.min(segmentPage, segmentPageCount);
  const visibleSegments = segments.slice((visibleSegmentPage - 1) * 50, visibleSegmentPage * 50);

  return (
    <div className="w-full min-w-0 space-y-3">
      <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-0 border border-border bg-bg-2">
        <button type="button" aria-expanded={modelExpanded} aria-controls="caption-model-settings" disabled={workerState === "loading"} onClick={() => setModelOpen(open => !open)} className="flex w-full min-w-0 items-center gap-2 rounded-[7px] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {workerState === "ready" ? <Check size={14} className="shrink-0 text-primary" aria-hidden /> : <Download size={14} className="shrink-0 text-fg-2" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-semibold text-fg">{t("Speech model:")} {WHISPER_MODELS[selectedModel].shortLabel}</span>
            <span className="block truncate text-[9px] text-fg-2">{workerState === "ready" ? t("Ready on this device") : workerState === "loading" ? t("Downloading") : t("Not downloaded yet")}</span>
          </span>
          <ChevronDown size={14} className={`shrink-0 text-fg-2 transition-transform ${modelExpanded ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <div id="caption-model-settings" hidden={!modelExpanded} className="space-y-2 border-t border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-fg-2 font-normal text-[10px]">
            {t("Model quality")}
          </span>
          <Select value={selectedModel} onValueChange={value => { if (isWhisperModelKey(value)) handleModelChange(value); }} disabled={workerState === "loading" || isTranscribing || isAdding}>
            <SelectTrigger aria-label={t("Local caption model")} className="h-7 w-44 min-w-0 rounded-[7px] border-border bg-bg-1 px-2.5 text-[12px] font-medium text-fg-2"><SelectValue/></SelectTrigger>
            <SelectContent>{Object.entries(WHISPER_MODELS).map(([value, model]) => <SelectItem key={value} value={value}>{t(model.label)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-start gap-2">
          {workerState === "ready" ? (
            <Check size={15} className="mt-0.5 text-primary" aria-hidden />
          ) : (
            <Download size={15} className="mt-0.5 text-primary" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <span className="font-bold block text-[11px] text-fg"
            >
              {WHISPER_MODELS[selectedModel].shortLabel}
            </span>
            <span className="text-fg-2 font-normal block text-[9px]"
            >
              {modelStatus}
            </span>
          </div>
        </div>
        {workerState === "loading" && (
          <Progress aria-label={t("Caption model download")} value={Number.isFinite(progress) ? Math.max(0, Math.min(100, progress * 100)) : 0} className="h-1.5 bg-bg-2"/>
        )}
        {workerState === "idle" && (
          <Button onClick={handlePrepareModel} type="button" aria-label={(`Download ${WHISPER_MODELS[selectedModel].shortLabel}`).trim() || undefined} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Download size={13} aria-hidden />}</span>
            <span className="truncate">{`Download ${WHISPER_MODELS[selectedModel].shortLabel}`}</span>
          </Button>
        )}
        <span className="text-fg-2 font-normal block text-[9px] leading-relaxed"
        >
          {t("Stored in this browser after the first download. Media never leaves your device.")}
        </span>
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-fg-2" aria-hidden />
            <span className="text-fg-2 font-normal text-[10px]">
              {t("Language")}
            </span>
          </div>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage} disabled={isTranscribing || isAdding}>
            <SelectTrigger aria-label={t("Caption language")} className="h-7 w-[132px] min-w-0 rounded-[7px] border-border bg-bg-1 px-2.5 text-[12px] font-medium text-fg-2"><SelectValue/></SelectTrigger>
            <SelectContent>{WHISPER_LANGUAGES.map(language => <SelectItem key={language.code} value={language.code}>{language.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-fg-2 font-normal text-[10px]">{t("Caption style")}</span>
          <CaptionStyleCards presets={CAPTION_STYLE_PRESETS} value={selectedStyle} onChange={setSelectedStyle} referenceStyles={controls.referenceStyles} disabled={isTranscribing || isAdding} />
        </div>
        <label className="flex items-center justify-between gap-3 text-[10px] text-fg-2"><span>{t("Highlight each word")}</span><Switch aria-label={t("Highlight each word")} checked={controls.highlightWords} onCheckedChange={controls.setHighlightWords} disabled={isTranscribing || isAdding}/></label>
        <label className="flex items-center justify-between gap-3 text-[10px] text-fg-2"><span>{t("Remove filler words (um, uh)")}</span><Switch aria-label={t("Remove filler words from captions")} checked={controls.removeFillers} onCheckedChange={controls.setRemoveFillers} disabled={isTranscribing || isAdding}/></label>
        <p className="text-[9px] text-fg-muted">{t("Filler cleanup changes caption text only. Source audio stays unchanged.")}</p>
      </Card>

      {error && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-start gap-2 border border-red-500/30 bg-red-500/10"
        >
          <AlertCircle
            size={14}
            className="mt-0.5 shrink-0 text-red-400"
            aria-hidden
          />
          <span className="font-normal text-[10px] text-red-400">
            {error}
          </span>
        </Card>
      )}

      {(isTranscribing || workerState === "loading") && <Button onClick={controls.cancel} type="button" aria-label={t("Cancel caption operation")} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
        <span className="truncate">{t("Cancel caption operation")}</span>
      </Button>}
      {isTranscribing && (
        <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 flex items-center gap-2">
          <Loader2
            size={14}
            className="animate-spin text-primary"
            aria-hidden
          />
          <span className="text-fg-2 font-normal text-[10px]">
            {progressMessage}
          </span>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div role="list" aria-label={t("Transcript segments")} className="max-h-36 space-y-1 overflow-y-auto">
            {visibleSegments.map((segment, index) => (
              <Card role="listitem" key={`${segment.startTime}-${index}`} className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 text-[10px]"
              >
                <span className="font-mono text-fg-muted">
                  {segment.startTime.toFixed(1)}s
                </span>
                <span className="ml-2 text-fg">{segment.text}</span>
              </Card>
            ))}
          </div>
          {segmentPageCount > 1 && <div className="flex items-center justify-between gap-2 text-[10px] text-fg-muted">
            <Button variant="ghost" size="sm" aria-label={t("Previous transcript page")} disabled={visibleSegmentPage === 1} onClick={() => setSegmentPage(visibleSegmentPage - 1)}>{t("Previous")}</Button>
            <span>{t("Page")} {visibleSegmentPage} {t("of")} {segmentPageCount}</span>
            <Button variant="ghost" size="sm" aria-label={t("Next transcript page")} disabled={visibleSegmentPage === segmentPageCount} onClick={() => setSegmentPage(visibleSegmentPage + 1)}>{t("Next")}</Button>
          </div>}
          <Button onClick={handleAddToTimeline} type="button" aria-label={(isAdding ? "Adding captions…" : `Add ${segments.length} as Editable Text`).trim() || undefined} disabled={(isAdding || mutationBlocked)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
            <span className="truncate">{isAdding ? t("Adding captions…") : `Add ${segments.length} as Editable Text`}</span>
          </Button>
        </div>
      )}

      <Button onClick={handleTranscribe} type="button" aria-label={isTranscribing ? t("Transcribing Locally…") : transcribeLabel} disabled={(!canTranscribe || isTranscribing || isAdding || workerState === "loading")} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isTranscribing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )}</span>
        <span className="truncate">{isTranscribing ? t("Transcribing Locally…") : transcribeLabel}</span>
      </Button>
      {!canTranscribe && (
        <span className="text-fg-2 font-normal block text-center text-[9px]"
        >
          {t("Select a connected video or audio clip first.")}
        </span>
      )}
    </div>
  );
}

