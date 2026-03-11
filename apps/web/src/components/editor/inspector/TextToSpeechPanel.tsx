import React, { useState } from "react";
import {
  Mic,
  Loader2,
  Volume2,
  Settings,
  Sparkles,
} from "lucide-react";
import { Slider, Switch } from "@openreel/ui";
import { useSettingsStore, type TtsProvider } from "../../../stores/settings-store";
import { useElevenLabsApi } from "./hooks/useElevenLabsApi";
import { useTtsActions } from "./hooks/useTtsActions";
import { VoiceBrowser } from "./VoiceBrowser";
import { ModelSelector } from "./ModelSelector";
import { EnhancedTextPreview } from "./EnhancedTextPreview";
import { AudioResult } from "./AudioResult";
import { TTS_PROVIDERS } from "./tts-constants";

export const TextToSpeechPanel: React.FC = () => {
  const {
    defaultTtsProvider,
    defaultLlmProvider,
    openSettings,
    settingsOpen,
    configuredServices,
    elevenLabsModel,
    favoriteVoices,
  } = useSettingsStore();

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");

  const defaultProvider: TtsProvider =
    defaultTtsProvider === "elevenlabs" && hasElevenLabsKey
      ? "elevenlabs"
      : "piper";

  const [provider, setProvider] = useState<TtsProvider>(defaultProvider);
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(
    defaultProvider === "elevenlabs" && favoriteVoices.length > 0
      ? favoriteVoices[0].voiceId
      : "amy",
  );
  const [speed, setSpeed] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [enhanceText, setEnhanceText] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);

  const {
    allVoices,
    allModels,
    isLoadingVoices,
    isLoadingModels,
    generateWithElevenLabs,
    generateWithPiper,
    enhanceViaLlm,
  } = useElevenLabsApi({
    provider,
    hasElevenLabsKey,
    settingsOpen,
    elevenLabsModel,
    defaultLlmProvider,
  });

  const {
    isGenerating,
    isPlaying,
    isEnhancing,
    generatedAudio,
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
    setGeneratedAudio,
  } = useTtsActions({
    provider,
    selectedVoice,
    text,
    speed,
    enhanceText,
    enhancedPreview,
    allVoices,
    favoriteVoices,
    generateWithElevenLabs,
    generateWithPiper,
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

      <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/30">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" />
          <div>
            <span className="text-[11px] font-medium text-text-primary">
              Text to Speech
            </span>
            <p className="text-[9px] text-text-muted">AI voice generation</p>
          </div>
        </div>
        <button
          onClick={() => openSettings("api-keys")}
          className="p-1.5 rounded-md hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="API Key Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Provider
        </label>
        <div className="flex gap-1.5">
          {TTS_PROVIDERS.map((p) => {
            const isDisabled = p.id === "elevenlabs" && !hasElevenLabsKey;
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (isDisabled) {
                    openSettings("api-keys");
                    return;
                  }
                  setProvider(p.id);
                  setSelectedVoice(
                    p.id === "elevenlabs"
                      ? (favoriteVoices.length > 0 ? favoriteVoices[0].voiceId : "")
                      : "amy",
                  );
                  setGeneratedAudio(null);
                }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                  provider === p.id
                    ? "bg-primary text-white font-medium"
                    : isDisabled
                      ? "bg-background-tertiary text-text-muted border border-border opacity-60 cursor-default"
                      : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                }`}
                title={isDisabled ? "Add ElevenLabs API key in Settings" : p.description}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {provider === "elevenlabs" && hasElevenLabsKey && (
        <ModelSelector allModels={allModels} isLoadingModels={isLoadingModels} />
      )}

      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Text
        </label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setEnhancedPreview(null); }}
          placeholder="Enter the text you want to convert to speech..."
          className="w-full h-24 px-3 py-2 text-[11px] bg-background-tertiary rounded-lg border border-border focus:border-primary focus:outline-none resize-none"
          maxLength={maxChars}
        />
        <div className="flex items-center justify-between">
          {provider === "elevenlabs" ? (
            <div className="flex items-center gap-1.5">
              <Switch
                checked={enhanceText}
                onCheckedChange={setEnhanceText}
                className="scale-75 origin-left"
              />
              <label className="text-[9px] text-text-muted flex items-center gap-1 cursor-pointer" onClick={() => setEnhanceText(!enhanceText)}>
                <Sparkles size={10} className={enhanceText ? "text-amber-400" : ""} />
                Enhance for TTS
              </label>
            </div>
          ) : (
            <div />
          )}
          <span className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-text-muted"}`}>
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
        provider={provider}
        selectedVoice={selectedVoice}
        onSelectVoice={setSelectedVoice}
        allVoices={allVoices}
        isLoadingVoices={isLoadingVoices}
      />

      {provider === "piper" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-text-secondary">Speed</label>
            <span className="text-[10px] text-text-muted">{speed.toFixed(1)}x</span>
          </div>
          <Slider min={0.5} max={2.0} step={0.1} value={[speed]} onValueChange={(value) => setSpeed(value[0])} />
          <div className="flex justify-between text-[8px] text-text-muted">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between gap-2">
          <p className="text-[10px] text-red-400">{error}</p>
          {(error.includes("API key") || error.includes("Session locked") || error.includes("Unlock")) && (
            <button
              onClick={() => openSettings("api-keys")}
              className="shrink-0 px-2 py-1 rounded text-[9px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      {successMsg && (
        <div className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-[10px] text-green-400">{successMsg}</p>
        </div>
      )}

      {enhanceText && provider === "elevenlabs" && !enhancedPreview && (
        <button
          onClick={handleEnhance}
          disabled={isEnhancing || !text.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg text-[11px] font-medium transition-all hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isEnhancing ? (
            <><Loader2 size={14} className="animate-spin" /> Enhancing...</>
          ) : (
            <><Sparkles size={14} /> Enhance Text</>
          )}
        </button>
      )}

      <button
        onClick={generateSpeech}
        disabled={isGenerating || !text.trim() || (provider === "elevenlabs" && !selectedVoice) || (enhanceText && provider === "elevenlabs" && !enhancedPreview)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-[11px] font-medium transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <><Loader2 size={14} className="animate-spin" /> Generating...</>
        ) : (
          <><Volume2 size={14} /> Generate Speech</>
        )}
      </button>

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

      <p className="text-[9px] text-text-muted text-center">
        Powered by {provider === "elevenlabs" ? "ElevenLabs" : "Piper TTS"}
        {provider === "elevenlabs" && ` · ${getSelectedModelName()}`}
      </p>
    </div>
  );
};

export default TextToSpeechPanel;
