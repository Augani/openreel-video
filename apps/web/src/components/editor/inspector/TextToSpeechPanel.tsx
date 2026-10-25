import React, { useState } from "react";
import { ENV_ELEVENLABS_API_KEY } from "../../../services/secure-storage";
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
import { MockToggle } from "./shell/InspectorControls";
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

  const hasElevenLabsKey = (Boolean(ENV_ELEVENLABS_API_KEY) || configuredServices.includes("elevenlabs"));

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

      <Card
        variant="green"
        padding={2}
        className="flex items-center justify-between border border-primary/30"
      >
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" aria-hidden />
          <div className="flex flex-col gap-0.5 min-w-0">
            <Text type="body" color="primary" weight="bold" display="block" className="text-[11px]">
              Text to Speech
            </Text>
            <Text type="supporting" color="secondary" display="block" className="text-[9px]">
              User-keyed ElevenLabs voice generation
            </Text>
          </div>
        </div>
        <IconButton
          label="API Key Settings"
          icon={<Settings size={14} aria-hidden />}
          variant="ghost"
          size="sm"
          onClick={() => openSettings("api-keys")}
          className="text-fg-3 hover:text-fg"
        />
      </Card>

      {!hasElevenLabsKey && (
        <Card variant="yellow" padding={2} className="border border-amber-500/30">
          <Text type="supporting" className="text-[10px] text-amber-400">
            Add your ElevenLabs API key to enable speech generation. OpenReel no longer hosts a speech server.
          </Text>
        </Card>
      )}

      {hasElevenLabsKey && (
        <ModelSelector allModels={allModels} isLoadingModels={isLoadingModels} />
      )}

      <div className="space-y-2">
        <ToolcraftTextAreaControl
          label="Text"
          value={text}
          onChange={(value) => {
            setText(value);
            setEnhancedPreview(null);
          }}
          placeholder="Enter the text you want to convert to speech..."
          maxLength={maxChars}
          rows={4}
          width="100%"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MockToggle
              ariaLabel="Enhance for TTS"
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
              Enhance for TTS
            </Text>
          </div>
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
        selectedVoice={selectedVoice}
        onSelectVoice={setSelectedVoice}
        allVoices={allVoices}
        isLoadingVoices={isLoadingVoices}
      />

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
              label="Open Settings"
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

      {enhanceText && !enhancedPreview && (
        <Button
          label={isEnhancing ? "Enhancing..." : "Enhance Text"}
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
        label={isGenerating ? "Generating..." : "Generate Speech"}
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
        isDisabled={isGenerating || !hasElevenLabsKey || !text.trim() || !selectedVoice || (enhanceText && !enhancedPreview)}
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
            Unsaved audio — save to media, add to timeline, or download to keep it.
          </Text>
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
        Powered by ElevenLabs · {getSelectedModelName()}
      </Text>
    </div>
  );
};

export default TextToSpeechPanel;
