import React from "react";
import { Zap, Loader2, Upload } from "@/icons/lucide-compat";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";

import { Input } from "@openreel/ui";
import { AutoReframeSection } from "../";
import { AutoCaptionPanel } from "../AutoCaptionPanel";
import { CaptionEditorPanel } from "../CaptionEditorPanel";
import { AutoEditPanel } from "../../panels/AutoEditPanel";
import { HighlightExtractorPanel } from "../../panels/HighlightExtractorPanel";
import { InspectorSection } from "../shell/InspectorSection";
import { useSceneDetectionDialogStore } from "../../../../stores/scene-detection-dialog-store";
import { Film } from "@/icons/lucide-compat";

interface AiTabProps {
  clipId: string;
  clipType: string | null;
  showVideoControls: boolean;
  showAudioEffects: boolean;
  showVideoEffects: boolean;
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
  captionWordsPerLine: number;
  onCaptionWordsPerLineChange: (value: number) => void;
}

export const AiTab: React.FC<AiTabProps> = ({
  clipId,
  clipType,
  showVideoControls,
  showAudioEffects,
  showVideoEffects,
  handleSRTImport,
  srtInputRef,
  handleRemoveBackground,
  handleEnhanceAudio,
  handleAutoColor,
  isEnhancingAudio,
  audioEnhanced,
  isApplyingSelectedClipEffect,
  captionWordsPerLine,
  onCaptionWordsPerLineChange,
}) => {
  return (
    <>
      {(clipType === "video" || clipType === "audio") && showAudioEffects && (
        <>
          <InspectorSection
            title="Local Auto-Captions"
            sectionId="auto-captions"
            defaultOpen={false}
          >
            <div className="space-y-3">
              <AutoCaptionPanel
                clipId={clipId}
                maxWordsPerLine={captionWordsPerLine}
              />
              <Input
                ref={srtInputRef}
                type="file"
                aria-label="Import SRT or VTT file"
                accept=".srt,.vtt,text/srt,text/vtt,text/plain"
                onChange={(event) => { void handleSRTImport(event); }}
                className="hidden"
              />
              <Button onClick={() => srtInputRef.current?.click()} type="button" aria-label="Import SRT / VTT as Text" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Upload size={13} aria-hidden />}</span>
                <span className="truncate">{"Import SRT / VTT as Text"}</span>
              </Button>
            </div>
          </InspectorSection>
        </>
      )}

      {(clipType === "video" || clipType === "audio") && showAudioEffects && (
        <InspectorSection
          title="Editable Captions"
          sectionId="editable-captions"
          defaultOpen={false}
        >
          <CaptionEditorPanel
            maxWordsPerLine={captionWordsPerLine}
            onMaxWordsPerLineChange={onCaptionWordsPerLineChange}
          />
        </InspectorSection>
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

      {clipType === "video" && (
        <InspectorSection
          title="Scene Edit Detection"
          sectionId="scene-edit-detection"
          defaultOpen={false}
        >
          <div className="space-y-2">
            <p className="text-[11px] text-fg-3">
              Find hard cuts in this clip, then split it or add markers.
            </p>
            <Button
              type="button"
              aria-label="Detect Scene Edits"
              onClick={() => useSceneDetectionDialogStore.getState().open(clipId)}
              className="inline-flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-[7px] border border-border bg-bg-2 px-2.5 text-[12px] font-semibold text-fg-2 outline-none transition-colors hover:bg-bg-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Film size={13} aria-hidden />
              <span className="truncate">Detect Scene Edits…</span>
            </Button>
          </div>
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
          title="Local Highlights"
          sectionId="ai-highlights"
          defaultOpen={false}
        >
          <HighlightExtractorPanel clipId={clipId} />
        </InspectorSection>
      )}

      {(showVideoControls || showAudioEffects || showVideoEffects) && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-4 relative overflow-hidden border border-primary/30 bg-primary/5"
        >
          <div className="flex items-center gap-2 text-primary mb-3">
            <Zap size={14} />
            <span className="text-accent text-xs font-bold">
              Quick Actions
            </span>
          </div>
          <div className="space-y-2">
            {showVideoControls && (
              <Button onClick={handleRemoveBackground} type="button" aria-label="Remove Background" disabled={(isApplyingSelectedClipEffect)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg", `w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`)}>
                <span className="truncate">{"Remove Background"}</span>
              </Button>
            )}
            {showAudioEffects && (
              <Button onClick={handleEnhanceAudio} type="button" aria-label={(isEnhancingAudio
                    ? "Cleaning up..."
                    : audioEnhanced
                      ? "Noise Reduced"
                      : "Quick Dialogue Cleanup").trim() || undefined} disabled={(isEnhancingAudio || isApplyingSelectedClipEffect)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg", `w-full justify-center ${
                  audioEnhanced
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : isEnhancingAudio || isApplyingSelectedClipEffect
                      ? "bg-bg-2 border-border text-fg-3"
                      : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`)}>
                {(isEnhancingAudio ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined) ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isEnhancingAudio ? <Loader2 size={12} className="animate-spin" aria-hidden /> : undefined}</span> : null}
                <span className="truncate">{isEnhancingAudio
                    ? "Cleaning up..."
                    : audioEnhanced
                      ? "Noise Reduced"
                      : "Quick Dialogue Cleanup"}</span>
              </Button>
            )}
            {showVideoEffects && (
              <Button onClick={handleAutoColor} type="button" aria-label={(isApplyingSelectedClipEffect ? "Applying..." : "Auto-Color").trim() || undefined} disabled={(isApplyingSelectedClipEffect)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg", `w-full justify-center ${
                  isApplyingSelectedClipEffect
                    ? "bg-bg-2 border-border text-fg-3"
                    : "bg-bg-2 hover:bg-primary hover:text-white border-border hover:border-primary"
                }`)}>
                <span className="truncate">{isApplyingSelectedClipEffect ? "Applying..." : "Auto-Color"}</span>
              </Button>
            )}
          </div>
        </Card>
      )}
    </>
  );
};
