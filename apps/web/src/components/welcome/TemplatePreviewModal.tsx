import { useState, useCallback, useMemo } from "react";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import {
  Play,
  Layers,
  ChevronRight,
  Type,
  Image,
  Palette,
  Sliders,
  ToggleLeft,
  Hash,
  Music,
} from "@/icons/lucide-compat";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import type {
  ScriptableTemplate,
  ExtendedPlaceholder,
  ScriptableTemplateReplacements,
  ExtendedPlaceholderType,
} from "@openreel/core";
import { useTranslation } from "react-i18next";

interface TemplatePreviewModalProps {
  template: ScriptableTemplate;
  onClose: () => void;
  onApply: () => void;
}

const PLACEHOLDER_ICONS: Record<ExtendedPlaceholderType, React.ElementType> = {
  text: Type,
  media: Image,
  subtitle: Type,
  shape: Layers,
  effect: Sliders,
  transform: Sliders,
  keyframe: Sliders,
  color: Palette,
  number: Hash,
  boolean: ToggleLeft,
  audio: Music,
  style: Palette,
  font: Type,
  animation: Play,
};

export const TemplatePreviewModal: React.FC<TemplatePreviewModalProps> = ({
  template,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation();
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const loadProject = useProjectStore((state) => state.loadProject);
  const { track } = useAnalytics();
  const [values, setValues] = useState<ScriptableTemplateReplacements>({});
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const groupedPlaceholders = useMemo(() => {
    const groups: Record<string, ExtendedPlaceholder[]> = {
      main: [],
      advanced: [],
    };

    for (const placeholder of template.placeholders) {
      if (placeholder.uiHints?.advanced) {
        groups.advanced.push(placeholder);
      } else {
        groups.main.push(placeholder);
      }
    }

    return groups;
  }, [template.placeholders]);

  const handleValueChange = useCallback(
    (placeholderId: string, value: unknown, type: ExtendedPlaceholderType) => {
      setValues((prev) => ({
        ...prev,
        [placeholderId]: { type, value },
      }));
    },
    [],
  );

  const handleApply = useCallback(async () => {
    setIsApplying(true);
    setError(null);

    try {
      const templateEngine = await getTemplateEngine();
      const titleEngine = getTitleEngine();

      const effectiveValues = { ...values };
      for (const placeholder of template.placeholders) {
        if (
          !effectiveValues[placeholder.id] &&
          placeholder.defaultValue !== undefined
        ) {
          effectiveValues[placeholder.id] = {
            type: placeholder.type,
            value: placeholder.defaultValue,
          };
        }
      }

      const { project, result, textClips } =
        templateEngine.applyScriptableTemplate(template, effectiveValues);

      if (!result.success && result.errors.length > 0) {
        setError(result.errors.map((e) => e.message).join(", "));
        setIsApplying(false);
        return;
      }

      if (titleEngine && textClips.length > 0) {
        for (const textClip of textClips) {
          const placeholder = template.placeholders.find(
            (p) => p.id === textClip.placeholderId,
          );
          const isTitle =
            placeholder?.label?.toLowerCase().includes("title") ||
            placeholder?.label?.toLowerCase().includes("headline");

          titleEngine.createTextClip({
            id: textClip.id,
            trackId: textClip.trackId,
            text: textClip.text,
            startTime: textClip.startTime,
            duration: textClip.duration,
            style: {
              fontFamily: "Inter",
              fontSize: isTitle ? 48 : 32,
              fontWeight: 600,
              fontStyle: "normal",
              color: "#ffffff",
              textAlign: "center",
              verticalAlign: "middle",
              letterSpacing: 0,
              lineHeight: 1.2,
            },
            transform: textClip.transform as Partial<
              import("@openreel/core").Transform
            >,
            animation: {
              preset: "fade",
              params: { easing: "ease-out" },
              inDuration: 0.5,
              outDuration: 0.3,
            },
          });
        }
      }

      loadProject({ ...project, modifiedAt: Date.now() });

      track(AnalyticsEvents.TEMPLATE_USED, {
        templateId: template.id,
        templateName: template.name,
        category: template.category,
        placeholderCount: template.placeholders.length,
      });

      onApply();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply template");
    } finally {
      setIsApplying(false);
    }
  }, [
    getTemplateEngine,
    getTitleEngine,
    loadProject,
    template,
    values,
    onApply,
    track,
  ]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={768}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={t(template.name)}
            onOpenChange={(open) => !open && onClose()}
            subtitle={`${formatDuration(template.timeline.duration)} · ${template.placeholders.length} editable fields`}
          />
        }
        content={
        <LayoutContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="aspect-video bg-background rounded-xl overflow-hidden mb-4 border border-border">
                {template.thumbnailUrl ? (
                  <img
                    src={template.thumbnailUrl}
                    alt={t(template.name)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-emerald-500/20 flex items-center justify-center">
                    <Play size={40} className="text-text-muted" />
                  </div>
                )}
              </div>

              {template.description && (
                <Text type="supporting" color="secondary" className="text-sm text-text-secondary mb-4">
                  {template.description}
                </Text>
              )}

              {template.scenes && template.scenes.length > 0 && (
                <div className="space-y-2">
                  <Text type="label" color="secondary" weight="medium" className="text-xs text-text-muted uppercase tracking-wide">
                    {t("Scenes")}</Text>
                  <div className="flex flex-wrap gap-2">
                    {template.scenes.map((scene) => (
                      <div
                        key={scene.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-background-tertiary rounded-lg text-xs border border-border"
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: scene.color || "#22c55e" }}
                        />
                        <span className="text-text-secondary">
                          {t(scene.label)}
                        </span>
                        <span className="text-text-muted">
                          ({formatDuration(scene.endTime - scene.startTime)})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary">
                {t("Customize Template")}</Text>

              {groupedPlaceholders.main.length > 0 && (
                <div className="space-y-4">
                  {groupedPlaceholders.main.map((placeholder) => (
                    <PlaceholderInput
                      key={placeholder.id}
                      placeholder={placeholder}
                      value={values[placeholder.id]?.value}
                      onChange={(value) =>
                        handleValueChange(
                          placeholder.id,
                          value,
                          placeholder.type,
                        )
                      }
                    />
                  ))}
                </div>
              )}

              {groupedPlaceholders.advanced.length > 0 && (
                <div>
                  <Button
                    label={`Advanced Options (${groupedPlaceholders.advanced.length})`}
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdvanced((value) => !value)}
                    icon={
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                        aria-hidden
                    />
                    }
                    className="text-xs text-text-muted cursor-pointer hover:text-text-secondary transition-colors"
                  />
                  {showAdvanced && (
                  <div className="mt-4 space-y-4 pl-4 border-l border-border">
                    {groupedPlaceholders.advanced.map((placeholder) => (
                      <PlaceholderInput
                        key={placeholder.id}
                        placeholder={placeholder}
                        value={values[placeholder.id]?.value}
                        onChange={(value) =>
                          handleValueChange(
                            placeholder.id,
                            value,
                            placeholder.type,
                          )
                        }
                      />
                    ))}
                  </div>
                  )}
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <Text type="supporting" className="text-sm text-red-400">{error}</Text>
                </div>
              )}
            </div>
          </div>
        </LayoutContent>
        }
        footer={
        <LayoutFooter>
          <Button label={t("Cancel")} variant="ghost" onClick={onClose} />
          <Button
            label={isApplying ? t("Applying...") : t("Use Template")}
            icon={isApplying ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <ChevronRight size={16} aria-hidden />
            )}
            variant="primary"
            onClick={handleApply}
            isDisabled={isApplying}
            className="shadow-glow"
          />
        </LayoutFooter>
        }
      />
    </Dialog>
  );
};

interface PlaceholderInputProps {
  placeholder: ExtendedPlaceholder;
  value: unknown;
  onChange: (value: unknown) => void;
}

const PlaceholderInput: React.FC<PlaceholderInputProps> = ({
  placeholder,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const Icon = PLACEHOLDER_ICONS[placeholder.type] || Type;
  const displayValue = value ?? placeholder.defaultValue ?? "";

  const renderInput = () => {
    switch (placeholder.type) {
      case "text":
      case "subtitle": {
        const maxLength = placeholder.constraints?.maxLength;
        return (
          <div className="space-y-1">
            <ToolcraftTextAreaControl
              label={t(placeholder.label)}
              isLabelHidden
              value={String(displayValue)}
              onChange={onChange}
              maxLength={maxLength}
              rows={2}
              placeholder={String(placeholder.defaultValue || "")}
              inputClassName="w-full px-3 py-2.5 text-sm bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none text-text-primary placeholder:text-text-muted resize-none transition-colors"
            />
            {maxLength && (
              <Text type="supporting" color="secondary" className="text-[10px] text-text-muted text-right">
                {String(displayValue).length}/{maxLength}
              </Text>
            )}
          </div>
        );
      }

      case "number": {
        const min = placeholder.constraints?.min ?? 0;
        const max = placeholder.constraints?.max ?? 100;
        const step = placeholder.constraints?.step || 1;
        const inputType = placeholder.uiHints?.inputType;

        if (inputType === "slider") {
          return (
            <div className="flex items-center gap-3">
              <ToolcraftSliderControl
                label={t(placeholder.label)}
                isLabelHidden
                value={Number(displayValue) || 0}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                valueDisplay="none"
                className="flex-1"
              />
              <span className="text-xs text-text-muted w-12 text-right font-mono">
                {Number(displayValue).toFixed(step < 1 ? 1 : 0)}
              </span>
            </div>
          );
        }

        return (
          <ToolcraftNumberInputControl
            label={t(placeholder.label)}
            isLabelHidden
            value={Number(displayValue) || 0}
            onChange={(next) => onChange(next ?? 0)}
            min={min}
            max={max}
            step={step}
            className="bg-background-tertiary border-border text-text-primary"
          />
        );
      }

      case "boolean":
        return (
          <div className="flex items-center gap-3">
            <ToolcraftSwitchControl
              label={placeholder.description || "Enabled"}
              checked={Boolean(displayValue)}
              onCheckedChange={(checked) => onChange(checked)}
            />
          </div>
        );

      case "color":
        return (
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-lg border border-border"
              style={{ backgroundColor: String(displayValue) || "#000000" }}
            />
            <ToolcraftTextInputControl
              label={t(placeholder.label)}
              isLabelHidden
              value={String(displayValue) || "#000000"}
              onChange={onChange}
              placeholder="#000000"
              className="flex-1 bg-background-tertiary border-border text-text-primary font-mono"
            />
          </div>
        );

      default:
        return (
          <ToolcraftTextInputControl
            label={t(placeholder.label)}
            isLabelHidden
            value={String(displayValue)}
            onChange={onChange}
            placeholder={String(placeholder.defaultValue || "")}
            className="bg-background-tertiary border-border text-text-primary"
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary">
          {t(placeholder.label)}
        </Text>
        {placeholder.required && (
          <span className="text-red-400 text-xs">*</span>
        )}
      </div>
      {placeholder.description && placeholder.type !== "boolean" && (
        <Text type="supporting" color="secondary" className="text-xs text-text-muted">{placeholder.description}</Text>
      )}
      {renderInput()}
    </div>
  );
};

export default TemplatePreviewModal;
