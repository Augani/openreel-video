import React, { useState, useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Mic, MicOff, Languages, AlertCircle } from "@/icons/lucide-compat";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { SpeechToTextEngine } from "@openreel/core";
import type {
  TranscriptionProgress,
  TranscriptionSegment,
} from "@openreel/core";
import { useTranslation } from "react-i18next";

const CAPTION_STYLE_PRESETS = [
  {
    id: "default",
    name: "Default",
    description: "White text on dark background",
  },
  { id: "modern", name: "Modern", description: "Clean, minimal style" },
  { id: "bold", name: "Bold", description: "Large, impactful text" },
  { id: "cinematic", name: "Cinematic", description: "Film-style captions" },
  { id: "minimal", name: "Minimal", description: "Subtle, understated" },
];

export const AutoCaptionPanel: React.FC = () => {
  const { t } = useTranslation();
  const getSpeechToTextEngine = useEngineStore(
    (state) => state.getSpeechToTextEngine,
  );
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const applySubtitleStylePreset = useProjectStore(
    (state) => state.applySubtitleStylePreset,
  );

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");
  const [selectedStyle, setSelectedStyle] = useState("default");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isSupported = useMemo(() => SpeechToTextEngine.isSupported(), []);
  const languages = useMemo(
    () => SpeechToTextEngine.getSupportedLanguages(),
    [],
  );

  const handleStartTranscription = useCallback(async () => {
    setError(null);
    setSegments([]);
    setIsTranscribing(true);

    try {
      const speechEngine = await getSpeechToTextEngine();

      speechEngine.setOptions({ language: selectedLanguage });

      speechEngine.onProgress((prog) => {
        setProgress(prog);
      });

      speechEngine.onSegment((segment) => {
        setSegments((prev) => [...prev, segment]);
      });

      await speechEngine.startLiveTranscription();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start transcription",
      );
      setIsTranscribing(false);
    }
  }, [getSpeechToTextEngine, selectedLanguage]);

  const handleStopTranscription = useCallback(async () => {
    const speechEngine = await getSpeechToTextEngine();

    const result = speechEngine.stopTranscription();
    setIsTranscribing(false);
    setProgress(null);

    if (result.success && result.segments.length > 0) {
      const subtitles = speechEngine.segmentsToSubtitles(result.segments);
      subtitles.forEach((subtitle) => {
        addSubtitle(subtitle);
      });

      if (selectedStyle !== "default") {
        await applySubtitleStylePreset(selectedStyle);
      }
    }
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    selectedStyle,
  ]);

  const handleApplySegments = useCallback(async () => {
    if (segments.length === 0) return;

    const speechEngine = await getSpeechToTextEngine();

    const subtitles = speechEngine.segmentsToSubtitles(segments);
    subtitles.forEach((subtitle) => {
      addSubtitle(subtitle);
    });

    if (selectedStyle !== "default") {
      await applySubtitleStylePreset(selectedStyle);
    }

    setSegments([]);
  }, [
    getSpeechToTextEngine,
    addSubtitle,
    applySubtitleStylePreset,
    segments,
    selectedStyle,
  ]);

  if (!isSupported) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-status-warning">
          <AlertCircle size={16} />
          <Text type="supporting" className="text-[11px] font-medium">
            {t("Browser Not Supported")}</Text>
        </div>
        <Text type="supporting" color="secondary" className="text-[10px]">
          {t("Auto-captions require Chrome or Edge browser with Speech Recognition API support.")}</Text>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <Card variant="muted" padding={2} className="flex items-center gap-2 border border-primary/30 bg-primary/10">
        <Mic size={16} className="text-primary" />
        <div className="flex flex-col gap-0.5">
          <Text type="supporting" color="primary" className="block text-[11px] font-medium">
            {t("Auto-Caption")}</Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            {t("Generate captions from speech")}</Text>
        </div>
      </Card>

      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages size={14} className="text-fg-2" />
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("Language")}</Text>
          </div>
          <Selector
            label={t("Language")}
            isLabelHidden
            size="sm"
            width={140}
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            isDisabled={isTranscribing}
            options={languages.map((lang) => ({
              label: t(lang.name),
              value: lang.code,
            }))}
          />
        </div>

        <div className="flex items-center justify-between">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {t("Caption Style")}</Text>
          <Selector
            label={t("Caption Style")}
            isLabelHidden
            size="sm"
            width={140}
            value={selectedStyle}
            onChange={setSelectedStyle}
            isDisabled={isTranscribing}
            options={CAPTION_STYLE_PRESETS.map((preset) => ({
              label: t(preset.name),
              value: preset.id,
            }))}
          />
        </div>
      </Card>

      {error && (
        <Card variant="muted" padding={2} className="flex items-center gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="text-red-400" />
          <Text type="supporting" className="text-[10px] text-red-400">
            {error}
          </Text>
        </Card>
      )}

      {isTranscribing && progress && (
        <Card variant="muted" padding={3} className="space-y-2">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("Status")}</Text>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <Text type="supporting" className="text-[10px] text-red-400">
                {t("Recording")}</Text>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-[10px]">
              {t("Segments Found")}</Text>
            <Text type="supporting" color="primary" className="font-mono text-[10px]">
              {progress.segmentsFound}
            </Text>
          </div>
        </Card>
      )}

      {segments.length > 0 && !isTranscribing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text type="supporting" color="secondary" className="text-[10px]">
              {segments.length} {t(" caption")}{segments.length !== 1 ? "s" : ""}{" "}
              {t("detected")}</Text>
            <Button
              label={t("Add to Timeline")}
              variant="primary"
              size="sm"
              onClick={handleApplySegments}
              className="px-2 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            />
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {segments.map((segment, index) => (
              <Card
                key={index}
                variant="muted"
                padding={2}
                className="p-2 bg-bg-1 rounded text-[10px] text-fg"
              >
                <Text as="span" type="supporting" color="secondary" className="font-mono">
                  [{segment.startTime.toFixed(1)}{t("s -")}{" "}
                  {segment.endTime.toFixed(1)}s]
                </Text>
                <Text as="span" type="supporting" color="primary" className="ml-2">
                  {segment.text}
                </Text>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!isTranscribing ? (
          <Button
            label={t("Start Recording")}
            icon={<Mic size={16} />}
            variant="primary"
            size="md"
            onClick={handleStartTranscription}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
          />
        ) : (
          <Button
            label={t("Stop Recording")}
            icon={<MicOff size={16} />}
            variant="primary"
            size="md"
            onClick={handleStopTranscription}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          />
        )}
      </div>

      <Text type="supporting" color="secondary" className="text-center text-[9px]">
        {t("Speak clearly into your microphone. Captions will be generated in real-time.")}</Text>
    </div>
  );
};

export default AutoCaptionPanel;
