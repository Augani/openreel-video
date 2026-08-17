import React from "react";
import { Sparkles, Trash2, Zap } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
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
  NestedSequenceSection,
  AdjustmentLayerSection,
  BackgroundRemovalSection,
  BehindSubjectSection,
} from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { MockToggle } from "../shell/InspectorControls";
import { PropertySlider } from "../shell/PropertySlider";
import {
  EditingTemplateControls,
  mergeEditingTemplateControlValues,
} from "../../panels/EditingTemplateControls";
import { toast } from "../../../../stores/notification-store";
import { ParticleEffectsSectionWrapper } from "./ParticleEffectsSectionWrapper";
import { useTranslation } from "react-i18next";

interface EffectsTabClip {
  duration: number;
  startTime: number;
}

export interface EffectsTabProps {
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
  const { t } = useTranslation();
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
                <Card
                  key={application.applicationId}
                  variant="muted"
                  padding={2}
                  className="border border-border bg-bg-2/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <Sparkles size={11} className="text-primary shrink-0" />
                      <Text
                        type="supporting"
                        color="primary"
                        className="truncate text-[11px] font-medium"
                      >
                        {application.name}
                      </Text>
                      <Text
                        type="supporting"
                        color="secondary"
                        className="shrink-0 text-[9px] capitalize"
                      >
                        {application.category?.replace(/-/g, " ") || "recipe"}
                      </Text>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {canEdit && (
                        <Button
                          label={t("Edit")}
                          onClick={() =>
                            handleToggleRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          }
                          variant={isExpanded ? "secondary" : "ghost"}
                          size="sm"
                          className={isExpanded ? "bg-primary/15 text-primary" : "text-fg-3"}
                        />
                      )}
                      <IconButton
                        label={t("Remove recipe")}
                        onClick={() => {
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
                        }}
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={11} aria-hidden />}
                        className="text-fg-3 hover:text-red-400"
                      />
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
                        <Button
                          label={t("Reset")}
                          onClick={() =>
                            handleResetRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          }
                          variant="secondary"
                          size="sm"
                        />
                        <Button
                          label={t("Update")}
                          onClick={() =>
                            handleUpdateRecipeControls(
                              application.applicationId,
                              application.templateId,
                              application.controlValues,
                            )
                          }
                          variant="primary"
                          size="sm"
                        />
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}

            {selectedTimelineClip.effects
              ?.filter((e: { metadata?: { templateSource?: unknown } }) => !e.metadata?.templateSource)
              .map((effect: { id: string; type: string; enabled?: boolean }) => (
                <Card
                  key={effect.id}
                  variant="muted"
                  padding={2}
                  className="flex items-center justify-between gap-2 border border-border bg-bg-2/70"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap size={11} className="text-amber-400 shrink-0" />
                    <Text
                      type="supporting"
                      color="primary"
                      className="truncate text-[11px] font-medium capitalize"
                    >
                      {effect.type.replace(/-/g, " ")}
                    </Text>
                  </div>
                  <Text
                    type="supporting"
                    color={effect.enabled !== false ? "active" : "secondary"}
                    className={`text-[9px] font-medium ${
                      effect.enabled !== false ? "text-green-400" : ""
                    }`}
                  >
                    {effect.enabled !== false ? "On" : "Off"}
                  </Text>
                </Card>
              ))}
          </div>
        </InspectorSection>
      )}

      {clipType === "video" && (
        <InspectorSection title={t("Background Removal")} sectionId="background-removal" defaultOpen={false}>
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
            title={t("Particle Effects")}
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
        <InspectorSection title={t("Chroma Key (Green Screen)")}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {t("Enable")}</Text>
              <MockToggle
                ariaLabel={t("Enable chroma key")}
                checked={chromaKeyEnabled}
                onChange={handleChromaKeyToggle}
              />
            </div>
            {chromaKeyEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {t("Key Color")}</Text>
                  <ToolcraftTextInputControl
                    label={t("Key Color")}
                    isLabelHidden
                    size="sm"
                    width={96}
                    value={keyColor}
                    onChange={handleKeyColorChange}
                    startIcon={
                      <span
                        aria-hidden
                        className="block h-4 w-4 rounded-sm border border-border"
                        style={{ backgroundColor: keyColor }}
                      />
                    }
                  />
                </div>
                <PropertySlider
                  label={t("Tolerance")}
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
        <InspectorSection title={t("Motion Tracking")} sectionId="motion-tracking">
          <MotionTrackingSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoEffects && (
        <InspectorSection title={t("Video Effects")} sectionId="video-effects">
          <VideoEffectsSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection
          title={t("Green Screen")}
          sectionId="green-screen"
          defaultOpen={false}
        >
          <GreenScreenSection clipId={clipId} />
        </InspectorSection>
      )}

      {/* Picture-in-Picture Section */}
      {showVideoControls && (
        <InspectorSection
          title={t("Picture-in-Picture")}
          sectionId="pip"
          defaultOpen={false}
        >
          <PiPSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title={t("Masking")} sectionId="masking" defaultOpen={false}>
          <MaskSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title={t("Nested Sequences")} defaultOpen={false}>
          <NestedSequenceSection clipId={clipId} />
        </InspectorSection>
      )}

      {showVideoControls && (
        <InspectorSection title={t("Adjustment Layers")} defaultOpen={false}>
          <AdjustmentLayerSection clipId={clipId} />
        </InspectorSection>
      )}

      {showTextSection && (
        <InspectorSection
          title={t("Text Behind Subject")}
          sectionId="text-behind-subject"
          defaultOpen={false}
        >
          <BehindSubjectSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
