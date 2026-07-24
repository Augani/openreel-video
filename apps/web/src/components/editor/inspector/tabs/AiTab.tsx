import React from "react";
import { Zap, Captions, Loader2, Upload } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftProgressBar as ProgressBar } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  type WhisperTranscriptionProgress,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import { AutoReframeSection } from "../";
import { AutoEditPanel } from "../../panels/AutoEditPanel";
import { HighlightExtractorPanel } from "../../panels/HighlightExtractorPanel";
import { InspectorSection } from "../shell/InspectorSection";
import { AIPanel } from "../../ai-panel/AIPanel";
import type { ClipMediaType } from "../../ai-panel/ai-kinds.config";
import { isDesktopGpuAvailable } from "../../../../services/gpu-jobs";

const GPU_CLIP_MEDIA: readonly ClipMediaType[] = ["video", "image", "audio"];

function asGpuClipMedia(clipType: string | null): ClipMediaType | null {
  return GPU_CLIP_MEDIA.includes(clipType as ClipMediaType) ? (clipType as ClipMediaType) : null;
}

export interface AiTabProps {
  clipId: string;
  clipType: string | null;
  showVideoControls: boolean;
  showAudioEffects: boolean;
  showVideoEffects: boolean;
  transcriptionProgress: WhisperTranscriptionProgress | null;
  isTranscribing: boolean;
  targetLanguage: string;
  setTargetLanguage: React.Dispatch<React.SetStateAction<string>>;
  defaultAnimationStyle: CaptionAnimationStyle;
  setDefaultAnimationStyle: React.Dispatch<
    React.SetStateAction<CaptionAnimationStyle>
  >;
  handleGenerateSubtitles: () => Promise<void>;
  handleSRTImport: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  srtInputRef: React.RefObject<HTMLInputElement | null>;
  handleRemoveBackground: () => void;
  handleEnhanceAudio: () => Promise<void>;
  handleAutoColor: () => Promise<void>;
  isEnhancingAudio: boolean;
  audioEnhanced: boolean;
  isApplyingSelectedClipEffect: boolean;
}

export const AiTab: React.FC<AiTabProps> = ({
  clipId,
  clipType,
  showVideoControls,
  showAudioEffects,
  showVideoEffects,
  transcriptionProgress,
  isTranscribing,
  targetLanguage,
  setTargetLanguage,
  defaultAnimationStyle,
  setDefaultAnimationStyle,
  handleGenerateSubtitles,
  handleSRTImport,
  srtInputRef,
  handleRemoveBackground,
  handleEnhanceAudio,
  handleAutoColor,
  isEnhancingAudio,
  audioEnhanced,
  isApplyingSelectedClipEffect,
}) => {
  const gpuClipMedia = asGpuClipMedia(clipType);
  // On desktop the local transcription endpoint (cloud.openreel.video) is
  // CORS-blocked from app://openreel, so generation is done via the GPU
  // "Auto Captions" tile in Cloud GPU Tools instead.
  const isDesktop = isDesktopGpuAvailable();

  return (
    <>
      {gpuClipMedia && (
        <InspectorSection
          title="Cloud GPU Tools"
          sectionId="cloud-gpu-tools"
          defaultOpen
        >
          <AIPanel clipTypeFilter={gpuClipMedia} embedded />
        </InspectorSection>
      )}

      {clipType === "video" && (
        <>
          <InspectorSection
            title="AI Auto-Captions"
            sectionId="auto-captions"
            defaultOpen={false}
          >
            <div className="space-y-3">
              <FileInput
                ref={srtInputRef}
                label="Import SRT file"
                isLabelHidden
                value={null}
                accept=".srt,text/srt,text/plain"
                onChange={(files) => {
                  const file = Array.isArray(files) ? files[0] : files;
                  if (!file) return;
                  void handleSRTImport({
                    target: { files: [file] },
                  } as unknown as React.ChangeEvent<HTMLInputElement>);
                }}
                className="hidden"
              />
              {isDesktop && (
                <Text type="supporting" color="secondary" className="text-[11px]">
                  Use the “Auto Captions” tool in Cloud GPU Tools above to generate captions.
                </Text>
              )}
              {!isDesktop && (
                <>
              <div className="space-y-1">
                <Selector
                  label="Animation Style"
                  size="sm"
                  width="100%"
                  value={defaultAnimationStyle}
                  onChange={(v) =>
                    setDefaultAnimationStyle(v as CaptionAnimationStyle)
                  }
                  isDisabled={isTranscribing}
                  options={CAPTION_ANIMATION_STYLES.map((style) => ({
                    label: getAnimationStyleDisplayName(style),
                    value: style,
                  }))}
                />
              </div>

              <div className="space-y-1">
                <Selector
                  label="Target Language"
                  size="sm"
                  width="100%"
                  value={targetLanguage}
                  onChange={setTargetLanguage}
                  isDisabled={isTranscribing}
                  options={[
                    { label: "Original (no translation)", value: "none" },
                    { label: "English", value: "en" },
                    { label: "Spanish", value: "es" },
                    { label: "French", value: "fr" },
                    { label: "German", value: "de" },
                    { label: "Portuguese", value: "pt" },
                    { label: "Italian", value: "it" },
                    { label: "Dutch", value: "nl" },
                    { label: "Russian", value: "ru" },
                    { label: "Chinese", value: "zh" },
                    { label: "Japanese", value: "ja" },
                    { label: "Korean", value: "ko" },
                    { label: "Arabic", value: "ar" },
                    { label: "Hindi", value: "hi" },
                    { label: "Turkish", value: "tr" },
                    { label: "Polish", value: "pl" },
                    { label: "Swedish", value: "sv" },
                  ]}
                />
              </div>

              {transcriptionProgress ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2
                      size={12}
                      className="animate-spin text-primary"
                    />
                    <Text type="supporting" color="primary" className="text-[10px]">
                      {transcriptionProgress.message}
                    </Text>
                  </div>
                  <ProgressBar
                    label="Caption generation progress"
                    isLabelHidden
                    value={transcriptionProgress.progress}
                    max={100}
                    hasValueLabel={false}
                    variant={
                      transcriptionProgress.phase === "error"
                        ? "error"
                        : transcriptionProgress.phase === "complete"
                          ? "success"
                          : "accent"
                    }
                  />
                </div>
              ) : (
                <Button
                  label="Generate Captions"
                  onClick={handleGenerateSubtitles}
                  isDisabled={isTranscribing}
                  variant="primary"
                  size="sm"
                  icon={<Captions size={14} aria-hidden />}
                  className="w-full justify-center"
                />
              )}
                </>
              )}
              <Button
                label="Import SRT File"
                onClick={() => srtInputRef.current?.click()}
                isDisabled={isTranscribing}
                variant="secondary"
                size="sm"
                icon={<Upload size={13} aria-hidden />}
                className="w-full justify-center"
              />
            </div>
          </InspectorSection>
        </>
      )}

      {clipType === "video" && (
        <InspectorSection
          title="Auto Reframe"
          sectionId="auto-reframe"
          defaultOpen={false}
        >
          <AutoReframeSection clipId={clipId} />
        </InspectorSection>
      )}

      {showAudioEffects && (
        <InspectorSection
          title="Beat-Synced Auto-Edit"
          sectionId="auto-edit"
          defaultOpen={false}
        >
          <AutoEditPanel onClose={() => {}} />
        </InspectorSection>
      )}

      {showAudioEffects && (
        <InspectorSection
          title="AI Highlights"
          sectionId="ai-highlights"
          defaultOpen={false}
        >
          <HighlightExtractorPanel clipId={clipId} />
        </InspectorSection>
      )}

      {(showVideoControls || showAudioEffects || showVideoEffects) && (
        <Card
          variant="green"
          padding={4}
          className="relative overflow-hidden border border-primary/30 bg-primary/5"
        >
          <div className="flex items-center gap-2 text-primary mb-3">
            <Zap size={14} />
            <Text type="supporting" color="active" className="text-xs font-bold">
              Quick Actions
            </Text>
          </div>
          <div className="space-y-2">
            {showVideoControls && (
              <Button
                label="Remove Background"
                onClick={handleRemoveBackground}
                isDisabled={isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                className={`w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
            {showAudioEffects && (
              <Button
                label={
                  isEnhancingAudio
                    ? "Cleaning up..."
                    : audioEnhanced
                      ? "Noise Reduced"
                      : "Quick Dialogue Cleanup"
                }
                onClick={handleEnhanceAudio}
                isDisabled={isEnhancingAudio || isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                icon={isEnhancingAudio ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined}
                className={`w-full justify-center ${
                  audioEnhanced
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : isEnhancingAudio || isApplyingSelectedClipEffect
                      ? "bg-bg-2 border-border text-fg-3"
                      : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
            {showVideoEffects && (
              <Button
                label={isApplyingSelectedClipEffect ? "Applying..." : "Auto-Color"}
                onClick={handleAutoColor}
                isDisabled={isApplyingSelectedClipEffect}
                variant="secondary"
                size="sm"
                className={`w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`}
              />
            )}
          </div>
        </Card>
      )}
    </>
  );
};
