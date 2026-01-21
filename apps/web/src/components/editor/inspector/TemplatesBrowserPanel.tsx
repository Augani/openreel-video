import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  FolderOpen,
  Video,
  Smartphone,
  Briefcase,
  User,
  Images,
  Play,
  Subtitles,
  Share,
  Folder,
  Plus,
  Clock,
  Layers,
  Cloud,
  ChevronLeft,
  Settings2,
} from "lucide-react";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  type TemplateSummary,
  type Template,
  type TemplateReplacements,
} from "@openreel/core";
import { templateCloudService } from "../../../services/template-cloud-service";
import { SaveTemplateDialog } from "../SaveTemplateDialog";
import { TemplateVariablesPanel } from "./TemplateVariablesPanel";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "social-media": Share,
  youtube: Video,
  tiktok: Smartphone,
  instagram: Smartphone,
  business: Briefcase,
  personal: User,
  slideshow: Images,
  "intro-outro": Play,
  "lower-third": Subtitles,
  custom: Folder,
};

interface TemplateCardProps {
  template: TemplateSummary & { source?: "local" | "cloud"; author?: string };
  isSelected: boolean;
  onSelect: () => void;
  onApply: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
  onApply,
}) => {
  const Icon = CATEGORY_ICONS[template.category] || FolderOpen;

  return (
    <div
      onClick={onSelect}
      className={`relative p-3 rounded-lg border cursor-pointer transition-all w-full max-w-full box-border ${
        isSelected
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border bg-background-tertiary hover:border-primary/50"
      }`}
    >
      <div className="flex items-start gap-3 w-full">
        <div
          className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${
            isSelected ? "bg-primary text-white" : "bg-background-secondary"
          }`}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-text-primary truncate">
              {template.name}
            </span>
            {template.id.startsWith("builtin-") && (
              <span className="px-1.5 py-0.5 text-[8px] bg-status-info/20 text-status-info rounded shrink-0">
                Built-in
              </span>
            )}
            {template.source === "cloud" && (
              <span className="px-1.5 py-0.5 text-[8px] bg-primary/20 text-primary rounded flex items-center gap-1 shrink-0">
                <Cloud size={8} />
                Cloud
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1 text-[9px] text-text-muted">
              <Layers size={10} />
              <span>{template.placeholderCount} placeholders</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-text-muted">
              <Clock size={10} />
              <span>{template.duration}s</span>
            </div>
          </div>
        </div>
      </div>
      {isSelected && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
          className="mt-3 w-full py-1.5 text-[10px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
        >
          Use This Template
        </button>
      )}
    </div>
  );
};

interface TemplatesBrowserPanelProps {
  onTemplateApplied?: () => void;
}

export const TemplatesBrowserPanel: React.FC<TemplatesBrowserPanelProps> = ({
  onTemplateApplied,
}) => {
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const loadProject = useProjectStore((state) => state.loadProject);

  const [selectedCategory, setSelectedCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [templates, setTemplates] = useState<
    Array<TemplateSummary & { source?: "local" | "cloud"; author?: string }>
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [loadedTemplate, setLoadedTemplate] = useState<Template | null>(null);
  const [placeholderValues, setPlaceholderValues] =
    useState<TemplateReplacements>({});
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);

  useEffect(() => {
    const loadTemplates = async () => {
      setIsLoading(true);

      try {
        const templateEngine = await getTemplateEngine();
        await templateEngine.initialize();
        const localTemplates = await templateEngine.listTemplates();
        const cloudTemplates = await templateCloudService.listTemplates();

        const combined = [
          ...localTemplates.map((t) => ({ ...t, source: "local" as const })),
          ...cloudTemplates.map((t) => ({ ...t, source: "cloud" as const })),
        ];

        const unique = Array.from(
          new Map(combined.map((t) => [t.id, t])).values(),
        );

        setTemplates(unique);
      } catch (error) {
        console.error("Failed to load templates:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTemplates();
  }, [getTemplateEngine]);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === "all") {
      return templates;
    }
    return templates.filter((t) => t.category === selectedCategory);
  }, [templates, selectedCategory]);

  const handleSelectTemplate = useCallback(
    async (templateId: string) => {
      setSelectedTemplateId(templateId);
      setApplyError(null);

      const templateEngine = await getTemplateEngine();

      const selectedTemplate = templates.find((t) => t.id === templateId);
      let template = await templateEngine.loadTemplate(templateId);

      if (!template && selectedTemplate?.source === "cloud") {
        template = await templateCloudService.getTemplate(templateId);
      }

      if (template) {
        setLoadedTemplate(template);
        setPlaceholderValues({});
        if (template.placeholders.length > 0) {
          setShowVariablesPanel(true);
        } else {
          setShowVariablesPanel(false);
        }
      }
    },
    [getTemplateEngine, templates],
  );

  const handleBackToTemplates = useCallback(() => {
    setShowVariablesPanel(false);
    setLoadedTemplate(null);
    setPlaceholderValues({});
  }, []);

  const handleApplyTemplate = useCallback(async () => {
    if (!selectedTemplateId) return;

    const templateEngine = await getTemplateEngine();
    const titleEngine = getTitleEngine();

    setApplyError(null);

    try {
      let template = loadedTemplate;

      if (!template) {
        const selectedTemplate = templates.find(
          (t) => t.id === selectedTemplateId,
        );
        template = await templateEngine.loadTemplate(selectedTemplateId);

        if (!template && selectedTemplate?.source === "cloud") {
          template = await templateCloudService.getTemplate(selectedTemplateId);
        }
      }

      if (!template) {
        setApplyError("Template not found");
        return;
      }

      const { project, missingPlaceholders, textClips } =
        templateEngine.applyTemplate(template, placeholderValues);

      if (missingPlaceholders.length > 0) {
        setApplyError(`Missing required: ${missingPlaceholders.join(", ")}`);
      }

      loadProject(project);

      if (titleEngine && textClips.length > 0) {
        for (const textClip of textClips) {
          const placeholder = template.placeholders.find(
            (p) => p.id === textClip.placeholderId,
          );
          const trackName = placeholder?.label || "Text";

          const track = project.timeline.tracks.find((t) =>
            t.clips.some((c) => c.id === textClip.id),
          );
          const clip = track?.clips.find((c) => c.id === textClip.id);

          if (track && clip) {
            titleEngine.createTextClip({
              id: textClip.id,
              trackId: track.id,
              text: textClip.text,
              startTime: clip.startTime,
              duration: clip.duration,
              style: {
                fontFamily: "Inter",
                fontSize: trackName.toLowerCase().includes("title") ? 32 : 48,
                fontWeight: 600,
                fontStyle: "normal",
                color: "#ffffff",
                textAlign: "center",
                verticalAlign: "middle",
                letterSpacing: 0,
                lineHeight: 1.2,
              },
              transform: clip.transform,
              animation: {
                preset: "fade",
                params: { easing: "ease-out" },
                inDuration: 0.5,
                outDuration: 0.3,
              },
            });
          }
        }
      }

      setShowVariablesPanel(false);
      setLoadedTemplate(null);
      setPlaceholderValues({});
      onTemplateApplied?.();
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : "Failed to apply template",
      );
    }
  }, [
    selectedTemplateId,
    getTemplateEngine,
    getTitleEngine,
    loadProject,
    onTemplateApplied,
    loadedTemplate,
    placeholderValues,
    templates,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (showVariablesPanel && loadedTemplate) {
    return (
      <div className="space-y-4 w-full min-w-0 max-w-full">
        <button
          onClick={handleBackToTemplates}
          className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
        >
          <ChevronLeft size={12} />
          <span>Back to Templates</span>
        </button>

        <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
          <Settings2 size={16} className="text-primary" />
          <div>
            <span className="text-[11px] font-medium text-text-primary">
              {loadedTemplate.name}
            </span>
            <p className="text-[9px] text-text-muted">
              Configure template variables
            </p>
          </div>
        </div>

        {applyError && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400">{applyError}</p>
          </div>
        )}

        <TemplateVariablesPanel
          template={loadedTemplate}
          values={placeholderValues}
          onChange={setPlaceholderValues}
          onApply={handleApplyTemplate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <FolderOpen size={16} className="text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            Templates
          </span>
          <p className="text-[9px] text-text-muted">
            Start with a pre-made project
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setSelectedCategory("all")}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
            selectedCategory === "all"
              ? "bg-primary text-white font-medium"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary"
          }`}
        >
          All
        </button>
        {TEMPLATE_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category.id] || FolderOpen;
          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? "bg-primary text-white font-medium"
                  : "bg-background-tertiary text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={12} />
              {category.name}
            </button>
          );
        })}
      </div>

      {applyError && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-[10px] text-red-400">{applyError}</p>
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto overflow-x-hidden">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen
              size={24}
              className="mx-auto mb-2 text-text-muted opacity-50"
            />
            <p className="text-[10px] text-text-muted">
              No templates in this category
            </p>
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isSelected={selectedTemplateId === template.id}
              onSelect={() => handleSelectTemplate(template.id)}
              onApply={handleApplyTemplate}
            />
          ))
        )}
      </div>

      <div className="pt-2 border-t border-border">
        <button
          onClick={() => setIsSaveDialogOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2 text-[10px] text-text-secondary hover:text-text-primary bg-background-tertiary rounded-lg transition-colors"
        >
          <Plus size={12} />
          <span>Save Current Project as Template</span>
        </button>
      </div>

      <p className="text-[9px] text-text-muted text-center">
        {templates.length} templates available
      </p>

      <SaveTemplateDialog
        isOpen={isSaveDialogOpen}
        onClose={() => {
          setIsSaveDialogOpen(false);
          const loadTemplates = async () => {
            setIsLoading(true);

            try {
              const templateEngine = await getTemplateEngine();
              await templateEngine.initialize();
              const localTemplates = await templateEngine.listTemplates();
              const cloudTemplates = await templateCloudService.listTemplates();

              const combined = [
                ...localTemplates.map((t) => ({
                  ...t,
                  source: "local" as const,
                })),
                ...cloudTemplates.map((t) => ({
                  ...t,
                  source: "cloud" as const,
                })),
              ];

              const unique = Array.from(
                new Map(combined.map((t) => [t.id, t])).values(),
              );

              setTemplates(unique);
            } catch (error) {
              console.error("Failed to load templates:", error);
            } finally {
              setIsLoading(false);
            }
          };
          loadTemplates();
        }}
      />
    </div>
  );
};

export default TemplatesBrowserPanel;
