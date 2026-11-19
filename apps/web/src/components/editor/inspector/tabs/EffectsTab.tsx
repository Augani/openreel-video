import React from "react";
import { Sparkles, Trash2, Zap } from "@/icons/lucide-compat";
import { Button, ColorPicker, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";


import type {
  AppliedEditingTemplate,
  Clip,
  EditingTemplate,
  EditingTemplatePrimitive,
} from "@openreel/core";
import {
  VideoEffectsSection,
  GreenScreenSection,
  PiPSection,
  MaskSection,
  MotionTrackingSection,
  PlanarTrackingSection,
  NestedSequenceSection,
  AdjustmentLayerSection,
  BackgroundRemovalSection,
  BehindSubjectSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { InspectorToggle } from "../shell/InspectorControls";
import { PropertySlider } from "../shell/PropertySlider";
import {
  EditingTemplateControls,
  mergeEditingTemplateControlValues,
} from "../../panels/EditingTemplateControls";
import { toast } from "../../../../stores/notification-store";
import { ParticleEffectsSectionWrapper } from "./ParticleEffectsSectionWrapper";

interface EffectsTabClip {
  duration: number;
  startTime: number;
}

interface EffectsTabProps {
  clipId: string;
  clipType: string | null;
  selectedClip: EffectsTabClip | null;
  selectedTimelineClip: Clip | null;
  showVideoControls: boolean;
  showVideoEffects: boolean;
  showTextSection: boolean;
  appliedEditingTemplates: AppliedEditingTemplate[];
  getEditingTemplate: (templateId: string) => EditingTemplate | undefined;
  removeEditingTemplateApplication: (
    clipId: string,
    applicationId: string,
  ) => boolean;
  expandedRecipeApplicationId: string | null;
  setExpandedRecipeApplicationId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  recipeControlValues: Record<
    string,
    Record<string, EditingTemplatePrimitive>
  >;
  setRecipeControlValues: React.Dispatch<
    React.SetStateAction<
      Record<string, Record<string, EditingTemplatePrimitive>>
    >
  >;
  handleRecipeControlChange: (
    applicationId: string,
    controlId: string,
    value: EditingTemplatePrimitive,
  ) => void;
  handleToggleRecipeControls: (
    applicationId: string,
    templateId: string,
    controlValues?: Record<string, unknown>,
  ) => void;
  handleResetRecipeControls: (
    applicationId: string,
    templateId: string,
    controlValues?: Record<string, unknown>,
  ) => void;
  handleUpdateRecipeControls: (
    applicationId: string,
    templateId: string,
    controlValues?: Record<string, unknown>,
  ) => void;
  chromaKeyEnabled: boolean;
  keyColor: string;
  tolerance: number;
  handleChromaKeyToggle: (enabled: boolean) => void;
  handleKeyColorChange: (hexColor: string) => void;
  handleToleranceChange: (tolerance: number) => void;
}

export const EffectsTab: React.FC<EffectsTabProps> = ({
  clipId,
  clipType,
  selectedClip,
  selectedTimelineClip,
  showVideoControls,
  showVideoEffects,
  showTextSection,
  appliedEditingTemplates,
  getEditingTemplate,
  removeEditingTemplateApplication,
  expandedRecipeApplicationId,
  setExpandedRecipeApplicationId,
  recipeControlValues,
  setRecipeControlValues,
  handleRecipeControlChange,
  handleToggleRecipeControls,
  handleResetRecipeControls,
  handleUpdateRecipeControls,
  chromaKeyEnabled,
  keyColor,
  tolerance,
  handleChromaKeyToggle,
  handleKeyColorChange,
  handleToleranceChange,
}) => {
  return (
    <>
      {showVideoControls && selectedTimelineClip && (appliedEditingTemplates.length > 0 || (selectedTimelineClip.effects && selectedTimelineClip.effects.length > 0)) && (
        <InspectorSection
          title={`Applied (${appliedEditingTemplates.length + (selectedTimelineClip.effects?.filter((e: { metadata?: { templateSource?: unknown } }) => !e.metadata?.templateSource).length || 0)})`}
          sectionId="applied-effects"
          defaultOpen={true}
        >
          <div className="space-y-2">
            {appliedEditingTemplates.map((application) => {
              const template = getEditingTemplate(application.templateId);
              const canEdit = Boolean(template?.controls?.length);
              const isExpanded =
                expandedRecipeApplicationId === application.applicationId;
              const currentControlValues = template
                ? recipeControlValues[application.applicationId] ||
                  mergeEditingTemplateControlValues(
                    template,
                    application.controlValues,
                  )
                : undefined;

              return (
                <Card key={application.applicationId} className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-border bg-bg-2/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <Sparkles size={11} className="text-primary shrink-0" />
                      <span className="text-fg truncate text-[11px] font-medium"
                      >
                        {application.name}
                      </span>
                      <span className="text-fg-2 font-normal shrink-0 text-[9px] capitalize"
                      >
                        {application.category?.replace(/-/g, " ") || "recipe"}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {canEdit && (
                        <Button onClick={() =>
                            handleToggleRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          } type="button" aria-label="Edit" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (isExpanded ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg"), isExpanded ? "bg-primary/15 text-primary" : "text-fg-3")}>
                          <span className="truncate">{"Edit"}</span>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-sm" onClick={() => {
                          const removed = removeEditingTemplateApplication(
                            selectedTimelineClip.id,
                            application.applicationId,
                          );
                          if (!removed) {
                            toast.error("Could not remove recipe", "The recipe could not be removed from this clip.");
                            return;
                          }
                          setRecipeControlValues((current) => {
                            const next = { ...current };
                            delete next[application.applicationId];
                            return next;
                          });
                          if (expandedRecipeApplicationId === application.applicationId) {
                            setExpandedRecipeApplicationId(null);
                          }
                        }} type="button" aria-label="Remove recipe" title="Remove recipe" className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent hover:bg-bg-2 text-fg-3 hover:text-red-400">
                        {<Trash2 size={11} aria-hidden />}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && template && currentControlValues && (
                    <div className="mt-2 space-y-3 rounded-lg border border-border/80 bg-bg-1/80 p-2.5">
                      <EditingTemplateControls
                        template={template}
                        values={currentControlValues}
                        onChange={(controlId, value) =>
                          handleRecipeControlChange(
                            application.applicationId,
                            controlId,
                            value,
                          )
                        }
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button onClick={() =>
                            handleResetRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          } type="button" aria-label="Reset" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                          <span className="truncate">{"Reset"}</span>
                        </Button>
                        <Button onClick={() =>
                            handleUpdateRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          } type="button" aria-label="Update" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
                          <span className="truncate">{"Update"}</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {selectedTimelineClip.effects
              ?.filter((e: { metadata?: { templateSource?: unknown } }) => !e.metadata?.templateSource)
              .map((effect: { id: string; type: string; enabled?: boolean }) => (
                <Card key={effect.id} className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-center justify-between gap-2 border border-border bg-bg-2/70"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap size={11} className="text-amber-400 shrink-0" />
                    <span className="text-fg truncate text-[11px] font-medium capitalize"
                    >
                      {effect.type.replace(/-/g, " ")}
                    </span>
                  </div>
                  <span className={cn("text-[12px] leading-5", (effect.enabled !== false ? "text-accent" : "text-fg-2"), "font-normal", `text-[9px] font-medium ${
                      effect.enabled !== false ? "text-green-400" : ""
                    }`)}
                  >
                    {effect.enabled !== false ? "On" : "Off"}
                  </span>
                </Card>
              ))}
          </div>
        </InspectorSection>
      )}

      {clipType === "video" && (
        <InspectorSection title="Background Removal" sectionId="background-removal" defaultOpen={false}>
          <BackgroundRemovalSection clipId={clipId} />
        </InspectorSection>
      )}

      {/* Particle Effects - Visual particle systems */}
      {(clipType === "video" ||
        clipType === "image" ||
        clipType === "text" ||
        clipType === "shape" ||
        clipType === "svg" ||
        clipType === "sticker") &&
        selectedClip && (
          <InspectorSection
            title="Particle Effects"
            sectionId="particle-effects"
            defaultOpen={false}
          >
            <ParticleEffectsSectionWrapper
              clipId={clipId}
              clipDuration={selectedClip.duration}
              clipStartTime={selectedClip.startTime}
            />
          </InspectorSection>
        )}

      {/* Chroma Key - Using ChromaKeyEngine - Only for video/image */}
      {showVideoControls && (
        <InspectorSection title="Chroma Key (Green Screen)" sectionId="chroma-key">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[10px]">
                Enable
              </span>
              <InspectorToggle
                ariaLabel="Enable chroma key"
                checked={chromaKeyEnabled}
                onChange={handleChromaKeyToggle}
              />
            </div>
            {chromaKeyEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-fg-2 font-normal text-[10px]">
                    Key Color
                  </span>
                  <ColorPicker
                    label="Key Color"
                    className="h-[30px] w-32 min-w-0 rounded-md px-2 text-xs"
                    value={keyColor}
                    onChange={handleKeyColorChange}
                  />
                </div>
                <PropertySlider
                  label="Tolerance"
                  value={tolerance}
                  onChange={handleToleranceChange}
                  min={0}
                  max={100}
                  formatValue={(value) => `${Math.round(value)}%`}
                />
              </>
            )}
          </div>
        </InspectorSection>
      )}

      {/* Motion Tracking - Using MotionTrackingEngine - Only for video/image */}
      {showVideoControls && (
        <InspectorSection title="Motion Tracking" sectionId="motion-tracking">
          <MotionTrackingSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title="Planar Tracking" sectionId="planar-tracking">
          <PlanarTrackingSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoEffects && (
        <InspectorSection title="Video Effects" sectionId="video-effects">
          <VideoEffectsSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection
          title="Green Screen"
          sectionId="green-screen"
          defaultOpen={false}
        >
          <GreenScreenSection clipId={clipId} />
        </InspectorSection>
      )}

      {/* Picture-in-Picture Section */}
      {showVideoControls && (
        <InspectorSection
          title="Picture-in-Picture"
          sectionId="pip"
          defaultOpen={false}
        >
          <PiPSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title="Masking" sectionId="masking" defaultOpen={false}>
          <MaskSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title="Nested Sequences" defaultOpen={false}>
          <NestedSequenceSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title="Adjustment Layers" defaultOpen={false}>
          <AdjustmentLayerSection clipId={clipId} />
        </InspectorSection>
      )}

      {showTextSection && (
        <InspectorSection
          title="Text Behind Subject"
          sectionId="text-behind-subject"
          defaultOpen={false}
        >
          <BehindSubjectSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
