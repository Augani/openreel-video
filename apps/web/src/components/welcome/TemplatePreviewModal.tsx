import { useState, useCallback, useMemo } from "react";
import {
  Play,
  Clock,
  Layers,
  ChevronRight,
  Type,
  Image,
  Palette,
  Sliders,
  ToggleLeft,
  Hash,
  Music,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Input,
  Switch,
  Label,
  Slider,
} from "@openreel/ui";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import type {
  ScriptableTemplate,
  ExtendedPlaceholder,
  ScriptableTemplateReplacements,
  ExtendedPlaceholderType,
} from "@openreel/core";

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
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const loadProject = useProjectStore((state) => state.loadProject);
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
  ]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col">
        <DialogHeader className="p-5 border-b border-border space-y-0 shrink-0">
          <DialogTitle className="text-lg font-semibold text-text-primary">
            {template.name}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-4 mt-1.5">
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <Clock size={12} />
                <span>{formatDuration(template.timeline.duration)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <Layers size={12} />
                <span>{template.placeholders.length} editable fields</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="aspect-video bg-background rounded-xl overflow-hidden mb-4 border border-border">
                {template.thumbnailUrl ? (
                  <img
                    src={template.thumbnailUrl}
                    alt={template.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/20 to-emerald-500/20 flex items-center justify-center">
                    <Play size={40} className="text-text-muted" />
                  </div>
                )}
              </div>

              {template.description && (
                <p className="text-sm text-text-secondary mb-4">
                  {template.description}
                </p>
              )}

              {template.scenes && template.scenes.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                    Scenes
                  </h3>
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
                          {scene.label}
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
              <h3 className="text-sm font-medium text-text-primary">
                Customize Template
              </h3>

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
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                  <CollapsibleTrigger className="text-xs text-text-muted cursor-pointer hover:text-text-secondary transition-colors flex items-center gap-1">
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                    />
                    Advanced Options ({groupedPlaceholders.advanced.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 space-y-4 pl-4 border-l border-border">
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
                  </CollapsibleContent>
                </Collapsible>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-border flex items-center justify-end gap-3 shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isApplying}
            className="shadow-glow"
          >
            {isApplying ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Applying...
              </>
            ) : (
              <>
                Use Template
                <ChevronRight size={16} />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
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
  const Icon = PLACEHOLDER_ICONS[placeholder.type] || Type;
  const displayValue = value ?? placeholder.defaultValue ?? "";

  const renderInput = () => {
    switch (placeholder.type) {
      case "text":
      case "subtitle": {
        const maxLength = placeholder.constraints?.maxLength;
        return (
          <div className="space-y-1">
            <textarea
              value={String(displayValue)}
              onChange={(e) => onChange(e.target.value)}
              maxLength={maxLength}
              rows={2}
              placeholder={String(placeholder.defaultValue || "")}
              className="w-full px-3 py-2.5 text-sm bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none text-text-primary placeholder:text-text-muted resize-none transition-colors"
            />
            {maxLength && (
              <p className="text-[10px] text-text-muted text-right">
                {String(displayValue).length}/{maxLength}
              </p>
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
              <Slider
                value={[Number(displayValue) || 0]}
                onValueChange={(vals) => onChange(vals[0])}
                min={min}
                max={max}
                step={step}
                className="flex-1"
              />
              <span className="text-xs text-text-muted w-12 text-right font-mono">
                {Number(displayValue).toFixed(step < 1 ? 1 : 0)}
              </span>
            </div>
          );
        }

        return (
          <Input
            type="number"
            value={Number(displayValue) || 0}
            onChange={(e) => onChange(Number(e.target.value))}
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
            <Switch
              checked={Boolean(displayValue)}
              onCheckedChange={(checked) => onChange(checked)}
            />
            <Label className="text-sm text-text-secondary cursor-pointer">
              {placeholder.description || "Enabled"}
            </Label>
          </div>
        );

      case "color":
        return (
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={String(displayValue) || "#000000"}
              onChange={(e) => onChange(e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border border-border"
            />
            <Input
              type="text"
              value={String(displayValue) || "#000000"}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#000000"
              className="flex-1 bg-background-tertiary border-border text-text-primary font-mono"
            />
          </div>
        );

      default:
        return (
          <Input
            type="text"
            value={String(displayValue)}
            onChange={(e) => onChange(e.target.value)}
            placeholder={String(placeholder.defaultValue || "")}
            className="bg-background-tertiary border-border text-text-primary"
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <Icon size={14} className="text-text-muted" />
        <span className="text-sm font-medium text-text-primary">
          {placeholder.label}
        </span>
        {placeholder.required && (
          <span className="text-red-400 text-xs">*</span>
        )}
      </label>
      {placeholder.description && placeholder.type !== "boolean" && (
        <p className="text-xs text-text-muted">{placeholder.description}</p>
      )}
      {renderInput()}
    </div>
  );
};

export default TemplatePreviewModal;
