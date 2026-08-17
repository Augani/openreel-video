import React, { useState, useCallback } from "react";
import {
  Mic,
  Loader2,
  Volume2,
  Settings,
  Sparkles,
  AlertTriangle,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { MockToggle } from "./shell/InspectorControls";
import { toast } from "../../../stores/notification-store";
import { useSettingsStore, type TtsProvider } from "../../../stores/settings-store";
import { useElevenLabsApi } from "./hooks/useElevenLabsApi";
import { useTtsActions } from "./hooks/useTtsActions";
import { VoiceBrowser } from "./VoiceBrowser";
import { ModelSelector } from "./ModelSelector";
import { EnhancedTextPreview } from "./EnhancedTextPreview";
import { AudioResult } from "./AudioResult";
import { TTS_PROVIDERS } from "./tts-constants";
import { useTranslation } from "react-i18next";

export const TextToSpeechPanel: React.FC = () => {
  const { t } = useTranslation();
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

  const warnUnsavedAudio = useCallback(() => {
    if (hasUnsavedAudio) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
  }, [hasUnsavedAudio]);

  const handleProviderSwitch = useCallback((newProvider: TtsProvider) => {
    if (newProvider === provider) return;
    warnUnsavedAudio();
    setProvider(newProvider);
    setSelectedVoice(
      newProvider === "elevenlabs"
        ? (favoriteVoices.length > 0 ? favoriteVoices[0].voiceId : "")
        : "amy",
    );
    setGeneratedAudio(null);
  }, [provider, warnUnsavedAudio, favoriteVoices, setGeneratedAudio]);

  const charCount = text.length;
  const maxChars = 5000;

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      <audio ref={audioRef as React.RefObject<HTMLAudioElement>} onEnded={handleAudioEnded} className="hidden" />

      <Card
        variant="green"
        padding={2}
        className="flex items-center justify-between border border-primary/30"
      >
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" aria-hidden />
          <div className="flex flex-col gap-0.5 min-w-0">
            <Text type="body" color="primary" weight="bold" display="block" className="text-[11px]">
              {t("Text to Speech")}</Text>
            <Text type="supporting" color="secondary" display="block" className="text-[9px]">
              {t("AI voice generation")}</Text>
          </div>
        </div>
        <IconButton
          label={t("API Key Settings")}
          icon={<Settings size={14} aria-hidden />}
          variant="ghost"
          size="sm"
          onClick={() => openSettings("api-keys")}
          className="text-fg-3 hover:text-fg"
        />
      </Card>

      <div className="space-y-2">
        <Text type="supporting" color="secondary" weight="bold" className="block text-[10px]">
          {t("Provider")}</Text>
        <div className="flex gap-1.5">
          {TTS_PROVIDERS.map((p) => {
            const isDisabled = p.id === "elevenlabs" && !hasElevenLabsKey;
            return (
              <Button
                key={p.id}
                label={t(p.label)}
                variant={provider === p.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => {
                  if (isDisabled) {
                    openSettings("api-keys");
                    return;
                  }
                  handleProviderSwitch(p.id);
                }}
                isDisabled={false}
                className={`flex-1 text-[10px] ${isDisabled ? "opacity-60" : ""}`}
              />
            );
          })}
        </div>
      </div>

      {provider === "elevenlabs" && hasElevenLabsKey && (
        <ModelSelector allModels={allModels} isLoadingModels={isLoadingModels} />
      )}

      <div className="space-y-2">
        <ToolcraftTextAreaControl
          label={t("Text")}
          value={text}
          onChange={(value) => {
            setText(value);
            setEnhancedPreview(null);
          }}
          placeholder={t("Enter the text you want to convert to speech...")}
          maxLength={maxChars}
          rows={4}
          width="100%"
        />
        <div className="flex items-center justify-between">
          {provider === "elevenlabs" ? (
            <div className="flex items-center gap-1.5">
              <MockToggle
                ariaLabel={t("Enhance for TTS")}
                checked={enhanceText}
                onChange={setEnhanceText}
              />
              <Text
                type="supporting"
                color="secondary"
                className="flex items-center gap-1 text-[9px] cursor-pointer"
                onClick={() => setEnhanceText(!enhanceText)}
              >
                <Sparkles size={10} className={enhanceText ? "text-amber-400" : ""} aria-hidden />
                {t("Enhance for TTS")}</Text>
            </div>
          ) : (
            <div />
          )}
          <Text
            type="supporting"
            className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-fg-3"}`}
          >
            {charCount}/{maxChars}
          </Text>
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
          <PropertySlider
            label={t("Speed")}
            min={0.5}
            max={2.0}
            step={0.1}
            value={speed}
            onChange={(value: number) => setSpeed(value)}
            formatValue={(value) => `${value.toFixed(1)}x`}
          />
          <div className="flex justify-between">
            <Text type="supporting" color="secondary" className="text-[8px]">0.5x</Text>
            <Text type="supporting" color="secondary" className="text-[8px]">1.0x</Text>
            <Text type="supporting" color="secondary" className="text-[8px]">2.0x</Text>
          </div>
        </div>
      )}

      {error && (
        <Card
          variant="red"
          padding={2}
          className="flex items-center justify-between gap-2 border border-red-500/30"
        >
          <Text type="supporting" className="text-[10px] text-red-400">
            {error}
          </Text>
          {(error.includes("API key") || error.includes("Session locked") || error.includes("Unlock")) && (
            <Button
              label={t("Open Settings")}
              variant="secondary"
              size="sm"
              onClick={() => openSettings("api-keys")}
              className="shrink-0 text-[9px]"
            />
          )}
        </Card>
      )}

      {successMsg && (
        <Card variant="green" padding={2} className="border border-green-500/30">
          <Text type="supporting" className="text-[10px] text-green-400">
            {successMsg}
          </Text>
        </Card>
      )}

      {enhanceText && provider === "elevenlabs" && !enhancedPreview && (
        <Button
          label={isEnhancing ? t("Enhancing...") : t("Enhance Text")}
          icon={
            isEnhancing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Sparkles size={14} aria-hidden />
            )
          }
          variant="primary"
          size="md"
          onClick={handleEnhance}
          isDisabled={isEnhancing || !text.trim()}
          isLoading={isEnhancing}
          className="w-full"
        />
      )}

      <Button
        label={isGenerating ? t("Generating...") : t("Generate Speech")}
        icon={
          isGenerating ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Volume2 size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={generateSpeech}
        isDisabled={isGenerating || !text.trim() || (provider === "elevenlabs" && !selectedVoice) || (enhanceText && provider === "elevenlabs" && !enhancedPreview)}
        isLoading={isGenerating}
        className="w-full"
      />

      {hasUnsavedAudio && (
        <Card
          variant="yellow"
          padding={2}
          className="flex items-center gap-1.5 border border-amber-500/30"
        >
          <AlertTriangle size={12} className="text-amber-400 shrink-0" aria-hidden />
          <Text type="supporting" className="text-[9px] text-amber-400">
            {t("Unsaved audio — save to media, add to timeline, or download to keep it.")}</Text>
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

      <Text type="supporting" color="secondary" className="block text-[9px] text-center">
        {t("Powered by ")}{provider === "elevenlabs" ? "ElevenLabs" : "Piper TTS"}
        {provider === "elevenlabs" && ` · ${getSelectedModelName()}`}
      </Text>
    </div>
  );
};

export default TextToSpeechPanel;
