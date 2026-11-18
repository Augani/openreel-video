import {
  Textarea as ShadcnTextarea,
  Label as ShadcnLabel,
  Button,
  cn,
  Card,
} from "@openreel/ui";
import React, { useState } from "react";
import {
  Mic,
  Loader2,
  Volume2,
  Settings,
  Sparkles,
  AlertTriangle,
} from "@/icons/lucide-compat";





import { InspectorToggle } from "./shell/InspectorControls";
import { useSettingsStore } from "../../../stores/settings-store";
import { useElevenLabsApi } from "./hooks/useElevenLabsApi";
import { useTtsActions } from "./hooks/useTtsActions";
import { VoiceBrowser } from "./VoiceBrowser";
import { ModelSelector } from "./ModelSelector";
import { EnhancedTextPreview } from "./EnhancedTextPreview";
import { AudioResult } from "./AudioResult";

export const TextToSpeechPanel: React.FC = () => {
  const {
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
    openSettings,
    settingsOpen,
    configuredServices,
    elevenLabsModel,
    favoriteVoices,
  } = useSettingsStore();

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");

  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(
    favoriteVoices.length > 0 ? favoriteVoices[0].voiceId : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [enhanceText, setEnhanceText] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);

  const {
    allVoices,
    allModels,
    isLoadingVoices,
    isLoadingModels,
    generateWithElevenLabs,
    enhanceViaLlm,
  } = useElevenLabsApi({
    hasElevenLabsKey,
    settingsOpen,
    elevenLabsModel,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
  });

  const {
    isGenerating,
    isPlaying,
    isEnhancing,
    generatedAudio,
    hasUnsavedAudio,
    successMsg,
    audioRef,
    getSelectedVoiceName,
    handleEnhance,
    generateSpeech,
    togglePlayback,
    handleAudioEnded,
    saveToMedia,
    addToTimeline,
    downloadAudio,
  } = useTtsActions({
    selectedVoice,
    text,
    enhanceText,
    enhancedPreview,
    allVoices,
    favoriteVoices,
    generateWithElevenLabs,
    enhanceViaLlm,
    setText,
    setError,
    setEnhancedPreview,
  });

  const getSelectedModelName = (): string => {
    const model = allModels.find((m) => m.model_id === elevenLabsModel);
    if (model) return model.name;
    return elevenLabsModel;
  };

  const charCount = text.length;
  const maxChars = 5000;

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      <audio ref={audioRef as React.RefObject<HTMLAudioElement>} onEnded={handleAudioEnded} className="hidden" />

      <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-2 flex items-center justify-between border border-primary/30"
      >
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" aria-hidden />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-fg font-bold block text-[11px]">
              Text to Speech
            </span>
            <span className="text-fg-2 font-normal block text-[9px]">
              User-keyed ElevenLabs voice generation
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => openSettings("api-keys")} type="button" aria-label="API Key Settings" title="API Key Settings" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 text-fg-3 hover:text-fg">
          {<Settings size={14} aria-hidden />}
        </Button>
      </Card>

      {!hasElevenLabsKey && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-warning/10 text-fg p-2 border border-amber-500/30">
          <span className="font-normal text-[10px] text-amber-400">
            Add your ElevenLabs API key to enable speech generation. OpenReel no longer hosts a speech server.
          </span>
        </Card>
      )}

      {hasElevenLabsKey && (
        <ModelSelector allModels={allModels} isLoadingModels={isLoadingModels} />
      )}

      <div className="space-y-2">
        <ShadcnLabel className="block min-w-0 space-y-1.5">
          <span className="block truncate text-[11px] font-medium text-text-secondary">
            {"Text"}
          </span>
          <ShadcnTextarea
            value={text}
            placeholder="Enter the text you want to convert to speech..."
            maxLength={maxChars}
            rows={4}
            aria-label={"Text"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setText(value);
              setEnhancedPreview(null);
            }}
            style={{ width: "100%" }}
            className={cn(
              "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
              "min-h-[5.75rem] resize-y leading-5",
            )}
          />
        </ShadcnLabel>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <InspectorToggle
              ariaLabel="Enhance for TTS"
              checked={enhanceText}
              onChange={setEnhanceText}
            />
            <span onClick={() => setEnhanceText(!enhanceText)} className="text-fg-2 font-normal flex items-center gap-1 text-[9px] cursor-pointer"
            >
              <Sparkles size={10} className={enhanceText ? "text-amber-400" : ""} aria-hidden />
              Enhance for TTS
            </span>
          </div>
          <span className={cn("text-[12px] leading-5", "text-fg-2", "font-normal", `text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-fg-3"}`)}
          >
            {charCount}/{maxChars}
          </span>
        </div>

        {enhancedPreview && enhanceText && (
          <EnhancedTextPreview
            enhancedPreview={enhancedPreview}
            onUpdate={setEnhancedPreview}
            onDiscard={() => setEnhancedPreview(null)}
          />
        )}
      </div>

      <VoiceBrowser
        selectedVoice={selectedVoice}
        onSelectVoice={setSelectedVoice}
        allVoices={allVoices}
        isLoadingVoices={isLoadingVoices}
      />

      {error && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-error/10 text-fg p-2 flex items-center justify-between gap-2 border border-red-500/30"
        >
          <span className="font-normal text-[10px] text-red-400">
            {error}
          </span>
          {(error.includes("API key") || error.includes("Session locked") || error.includes("Unlock")) && (
            <Button onClick={() => openSettings("api-keys")} type="button" aria-label="Open Settings" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg shrink-0 text-[9px]">
              <span className="truncate">{"Open Settings"}</span>
            </Button>
          )}
        </Card>
      )}

      {successMsg && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-2 border border-green-500/30">
          <span className="font-normal text-[10px] text-green-400">
            {successMsg}
          </span>
        </Card>
      )}

      {enhanceText && !enhancedPreview && (
        <Button onClick={handleEnhance} type="button" aria-label={(isEnhancing ? "Enhancing..." : "Enhance Text").trim() || undefined} disabled={(isEnhancing || !text.trim()) || (isEnhancing)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
          {(isEnhancing) ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isEnhancing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )}</span>}
          <span className="truncate">{isEnhancing ? "Enhancing..." : "Enhance Text"}</span>
        </Button>
      )}

      <Button onClick={generateSpeech} type="button" aria-label={(isGenerating ? "Generating..." : "Generate Speech").trim() || undefined} disabled={(isGenerating || !hasElevenLabsKey || !text.trim() || !selectedVoice || (enhanceText && !enhancedPreview)) || (isGenerating)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
        {(isGenerating) ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isGenerating ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Volume2 size={14} aria-hidden />
          )}</span>}
        <span className="truncate">{isGenerating ? "Generating..." : "Generate Speech"}</span>
      </Button>

      {hasUnsavedAudio && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-warning/10 text-fg p-2 flex items-center gap-1.5 border border-amber-500/30"
        >
          <AlertTriangle size={12} className="text-amber-400 shrink-0" aria-hidden />
          <span className="font-normal text-[9px] text-amber-400">
            Unsaved audio — save to media, add to timeline, or download to keep it.
          </span>
        </Card>
      )}

      {generatedAudio && (
        <AudioResult
          generatedAudio={generatedAudio}
          voiceName={getSelectedVoiceName()}
          isPlaying={isPlaying}
          isGenerating={isGenerating}
          onTogglePlayback={togglePlayback}
          onSaveToMedia={saveToMedia}
          onAddToTimeline={addToTimeline}
          onDownload={downloadAudio}
        />
      )}

      <span className="text-fg-2 font-normal block text-[9px] text-center">
        Powered by ElevenLabs · {getSelectedModelName()}
      </span>
    </div>
  );
};
