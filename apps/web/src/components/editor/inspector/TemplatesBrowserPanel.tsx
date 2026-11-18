import { TemplateThumb } from "../../welcome/TemplateThumb";
import React, {
  lazy,
  Suspense,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
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
} from "@/icons/lucide-compat";
import { Button, Card, ToggleGroup, ToggleGroupItem } from "@openreel/ui";

import { useEngineStore } from "../../../stores/engine-store";
import {
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  type TemplateSummary,
  type Template,
  type TemplateReplacements,
} from "@openreel/core";
import { templateCloudService } from "../../../services/template-cloud-service";
// The save dialog is only fetched when it is first opened.
const SaveTemplateDialog = lazy(() => import("../SaveTemplateDialog").then((m) => ({ default: m.SaveTemplateDialog })));
import { TemplateVariablesPanel } from "./TemplateVariablesPanel";
import {
  openTemplateProject,
  resolveTemplateMedia,
  templateEditorOwner,
} from "../../../services/project-templates";

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
  isApplying?: boolean;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  isSelected,
  onSelect,
  onApply,
  isApplying = false,
}) => {

  return (
    <Card
      className={`relative p-3 rounded-lg border cursor-pointer transition-all w-full max-w-full box-border ${
        isSelected
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border bg-bg-2 hover:border-primary/50"
      }`}
    >
      <Button
        variant="ghost"
        type="button"
        aria-label={`Select ${template.name} template`}
        aria-pressed={isSelected}
        disabled={isApplying}
        onClick={onSelect}
        className="h-auto w-full justify-start whitespace-normal p-0 text-left hover:bg-transparent"
      >
        <div className="flex items-start gap-3 w-full">
          <div
            className={`aspect-video w-[72px] shrink-0 overflow-hidden rounded-md border ${
              isSelected ? "border-primary" : "border-border"
            }`}
          >
            <TemplateThumb template={template} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-fg truncate">
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
              <div className="flex items-center gap-1 text-[9px] text-fg-3">
                <Layers size={10} />
                <span>{template.placeholderCount} placeholders</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] text-fg-3">
                <Clock size={10} />
                <span>{template.duration}s</span>
              </div>
            </div>
          </div>
        </div>
      </Button>
      {isSelected && (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
          type="button"
          aria-label="Use This Template"
          disabled={isApplying}
          className="inline-flex min-w-0 items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 mt-3 w-full py-1.5 text-[10px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
        >
          {isApplying ? (
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80"
            />
          ) : null}
          <span className="truncate">{"Use This Template"}</span>
        </Button>
      )}
    </Card>
  );
};

interface TemplatesBrowserPanelProps {
  onTemplateApplied?: () => void;
}

export const TemplatesBrowserPanel: React.FC<TemplatesBrowserPanelProps> = ({
  onTemplateApplied,
}) => {
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);

  const [selectedCategory, setSelectedCategory] = useState<
    TemplateCategory | "all"
  >("all");
  const [templates, setTemplates] = useState<
    Array<TemplateSummary & { source?: "local" | "cloud"; author?: string }>
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const applying = useRef(false);
  const application = useRef<AbortController | null>(null);
  const selectionRequest = useRef(0);
  useEffect(
    () => () => {
      application.current?.abort();
      selectionRequest.current++;
    },
    [],
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  // One dialog instance per opening, kept mounted while it closes so its exit animation plays.
  const [saveDialogSession, setSaveDialogSession] = useState(0);
  const [loadedTemplate, setLoadedTemplate] = useState<Template | null>(null);
  const [placeholderValues, setPlaceholderValues] =
    useState<TemplateReplacements>({});
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      setIsLoading(true);

      try {
        const templateEngine = await getTemplateEngine();
        await templateEngine.initialize();
        const localTemplates = await templateEngine.listTemplates();
        if (cancelled) return;
        setTemplates(
          localTemplates.map((t) => ({ ...t, source: "local" as const })),
        );
        setIsLoading(false);
        const cloudTemplates = await templateCloudService.listTemplates();
        if (cancelled) return;

        const combined = [
          ...localTemplates.map((t) => ({ ...t, source: "local" as const })),
          ...cloudTemplates.map((t) => ({ ...t, source: "cloud" as const })),
        ];

        const unique = Array.from(
          new Map(combined.map((t) => [t.id, t])).values(),
        );

        setTemplates(unique);
      } catch (error) {
        if (!cancelled)
          setApplyError(
            error instanceof Error ? error.message : "Failed to load templates",
          );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [getTemplateEngine, refresh]);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === "all") {
      return templates;
    }
    return templates.filter((t) => t.category === selectedCategory);
  }, [templates, selectedCategory]);

  const handleSelectTemplate = useCallback(
    async (templateId: string) => {
      if (applying.current) return;
      const request = ++selectionRequest.current;
      setLoadedTemplate(null);
      setSelectedTemplateId(templateId);
      setApplyError(null);

      try {
        const templateEngine = await getTemplateEngine();
        const selectedTemplate = templates.find((t) => t.id === templateId);
        let template = await templateEngine.loadTemplate(templateId);
        if (!template && selectedTemplate?.source === "cloud")
          template = await templateCloudService.getTemplate(templateId);
        if (request !== selectionRequest.current) return;
        if (!template) throw new Error("Template not found");
        setLoadedTemplate(template);
        setPlaceholderValues({});
        setShowVariablesPanel(template.placeholders.length > 0);
      } catch (error) {
        if (request === selectionRequest.current)
          setApplyError(
            error instanceof Error ? error.message : "Failed to load template",
          );
      }
    },
    [getTemplateEngine, templates],
  );

  const handleBackToTemplates = useCallback(() => {
    if (applying.current) return;
    selectionRequest.current++;
    setShowVariablesPanel(false);
    setLoadedTemplate(null);
    setPlaceholderValues({});
  }, []);

  const handleApplyTemplate = useCallback(async () => {
    if (!selectedTemplateId || applying.current) return;
    const owner = templateEditorOwner();
    const controller = new AbortController();
    application.current = controller;
    applying.current = true;
    setIsApplying(true);
    setApplyError(null);

    try {
      const templateEngine = await getTemplateEngine();
      let template =
        loadedTemplate?.id === selectedTemplateId ? loadedTemplate : null;

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

      const values = await resolveTemplateMedia(
        placeholderValues,
        owner,
        controller.signal,
      );
      const { project, missingPlaceholders } = templateEngine.applyTemplate(
        template,
        values,
      );
      if (missingPlaceholders.length > 0)
        throw new Error(`Missing required: ${missingPlaceholders.join(", ")}`);
      await openTemplateProject(project, owner, controller.signal);
      if (controller.signal.aborted) return;

      setShowVariablesPanel(false);
      setLoadedTemplate(null);
      setPlaceholderValues({});
      onTemplateApplied?.();
    } catch (error) {
      if (!controller.signal.aborted)
        setApplyError(
          error instanceof Error ? error.message : "Failed to apply template",
        );
    } finally {
      applying.current = false;
      if (!controller.signal.aborted) setIsApplying(false);
    }
  }, [
    selectedTemplateId,
    getTemplateEngine,
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
        <Button
          onClick={handleBackToTemplates}
          type="button"
          disabled={isApplying}
          aria-label="Back to Templates"
          className="min-w-0 justify-center rounded-[7px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 bg-transparent hover:bg-bg-2 flex items-center gap-1.5 text-[10px] text-fg-3 hover:text-fg transition-colors"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {<ChevronLeft size={12} />}
          </span>
          <span className="truncate">{"Back to Templates"}</span>
        </Button>

        <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
          <Settings2 size={16} className="text-primary" />
          <div>
            <span className="text-[11px] font-medium text-fg">
              {loadedTemplate.name}
            </span>
            <span className="text-fg-2 font-normal block text-[9px]">
              Configure template variables
            </span>
          </div>
        </div>

        {applyError && (
          <div
            role="alert"
            className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg"
          >
            <span className="font-normal block text-[10px] text-red-400">
              {applyError}
            </span>
          </div>
        )}

        <TemplateVariablesPanel
          template={loadedTemplate}
          values={placeholderValues}
          onChange={setPlaceholderValues}
          onApply={handleApplyTemplate}
          isApplying={isApplying}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <FolderOpen size={16} className="text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-fg">Templates</span>
          <span className="text-fg-2 font-normal block text-[9px]">
            Start with a pre-made project
          </span>
        </div>
      </div>

      <ToggleGroup
        type="single"
        aria-label="Template category"
        value={selectedCategory}
        onValueChange={(value) => {
          if (value) setSelectedCategory(value as typeof selectedCategory);
        }}
        className="justify-start gap-1 overflow-x-auto pb-1 -mx-1 px-1"
      >
        {[{ id: "all", name: "All" }, ...TEMPLATE_CATEGORIES].map(
          (category) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <ToggleGroupItem
                key={category.id}
                value={category.id}
                aria-label={category.name}
                className="h-8 shrink-0 gap-1.5 whitespace-nowrap rounded-lg bg-bg-2 px-3 text-[10px] text-fg-2 data-[state=on]:bg-primary data-[state=on]:text-white"
              >
                {Icon && <Icon size={12} aria-hidden />}
                {category.name}
              </ToggleGroupItem>
            );
          },
        )}
      </ToggleGroup>

      {applyError && (
        <div
          role="alert"
          className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg"
        >
          <span className="font-normal block text-[10px] text-red-400">
            {applyError}
          </span>
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto overflow-x-hidden">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen
              size={24}
              className="mx-auto mb-2 text-fg-3 opacity-50"
            />
            <span className="text-fg-2 font-normal block text-[10px]">
              No templates in this category
            </span>
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isSelected={selectedTemplateId === template.id}
              onSelect={() => handleSelectTemplate(template.id)}
              onApply={handleApplyTemplate}
              isApplying={isApplying}
            />
          ))
        )}
      </div>

      <div className="pt-2 border-t border-border">
        <Button
          onClick={() => {
            setSaveDialogSession((value) => value + 1);
            setIsSaveDialogOpen(true);
          }}
          type="button"
          aria-label="Save Current Project as Template"
          disabled={isApplying}
          className="min-w-0 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 hover:bg-bg-2 w-full flex items-center justify-center gap-2 py-2 text-[10px] text-fg-2 hover:text-fg bg-bg-2 rounded-lg transition-colors"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {<Plus size={12} />}
          </span>
          <span className="truncate">{"Save Current Project as Template"}</span>
        </Button>
      </div>

      <span className="text-fg-2 font-normal block text-center text-[9px]">
        {templates.length} templates available
      </span>

      {saveDialogSession > 0 && (
        <Suspense fallback={null}>
          <SaveTemplateDialog
            key={saveDialogSession}
            isOpen={isSaveDialogOpen}
            onClose={() => {
              setIsSaveDialogOpen(false);
              setRefresh((value) => value + 1);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
