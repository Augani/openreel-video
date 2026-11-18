import { Input as ShadcnInput, Button, cn } from "@openreel/ui";
import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  Film,
  Zap,
  Clock,
  Share2,
  Palette,
  Layers,
  Type,
  ArrowRightLeft,
  Megaphone,
  MonitorSmartphone,
  PanelBottom,
  Package,
  Flag,
  Sticker,
  type LucideIcon,
} from "@/icons/lucide-compat";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  cinema: Film,
  glitch: Zap,
  retro: Clock,
  social: Share2,
  branding: Sticker,
  color: Palette,
  overlay: Layers,
  "text-effects": Type,
  transitions: ArrowRightLeft,
  ads: Megaphone,
  "app-ui-demos": MonitorSmartphone,
  "lower-thirds": PanelBottom,
  "product-shots": Package,
  "social-hooks": Share2,
  "kinetic-typography": Type,
  "logo-reveals": Sticker,
  "end-screens": Flag,
};




import {
  EDITING_TEMPLATE_CATEGORIES,
  type EditingTemplate,
  type EditingTemplateCategory,
  type EditingTemplatePrimitive,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";
import {
  EditingTemplateControls,
  getEditingTemplateDefaultControlValues,
} from "./EditingTemplateControls";

const formatCategoryLabel = (category: string): string =>
  category.replace(/-/g, " ");

export const RecipesTab: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const getEditingTemplates = useProjectStore((state) => state.getEditingTemplates);
  const applyEditingTemplate = useProjectStore(
    (state) => state.applyEditingTemplate,
  );
  const getSelectedClipIds = useUIStore((state) => state.getSelectedClipIds);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | EditingTemplateCategory
  >("all");
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(
    null,
  );
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(
    null,
  );
  const [controlValuesByTemplate, setControlValuesByTemplate] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});

  const selectedClipIds = getSelectedClipIds();
  const templates = useMemo(() => getEditingTemplates(), [getEditingTemplates]);

  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) {
      return null;
    }

    return getClip(selectedClipIds[0]) || null;
  }, [getClip, selectedClipIds, project.modifiedAt]);

  const selectedTrack = useMemo(() => {
    if (!selectedClip) {
      return null;
    }

    return (
      project.timeline.tracks.find((track) =>
        track.clips.some((clip) => clip.id === selectedClip.id),
      ) || null
    );
  }, [project.timeline.tracks, selectedClip]);

  const selectedTargetType =
    selectedTrack?.type === "image"
      ? "image"
      : selectedTrack?.type === "video"
        ? "video"
        : null;

  const selectedMedia = selectedClip
    ? getMediaItem(selectedClip.mediaId)
    : undefined;
  const appliedTemplates = selectedClip?.metadata?.appliedTemplates || [];

  useEffect(() => {
    if (!expandedTemplateId) {
      return;
    }

    const expandedTemplate = templates.find(
      (template) => template.id === expandedTemplateId,
    );
    if (!expandedTemplate || controlValuesByTemplate[expandedTemplateId]) {
      return;
    }

    setControlValuesByTemplate((current) => ({
      ...current,
      [expandedTemplateId]: getEditingTemplateDefaultControlValues(expandedTemplate),
    }));
  }, [controlValuesByTemplate, expandedTemplateId, templates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      if (
        selectedTargetType &&
        template.supportedTargets &&
        !template.supportedTargets.includes(selectedTargetType)
      ) {
        return false;
      }

      if (selectedCategory !== "all" && template.category !== selectedCategory) {
        return false;
      }

      if (!searchQuery.trim()) {
        return true;
      }

      const query = searchQuery.trim().toLowerCase();
      return (
        template.name.toLowerCase().includes(query) ||
        template.description.toLowerCase().includes(query) ||
        template.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [searchQuery, selectedCategory, selectedTargetType, templates]);

  const handleExpand = (template: EditingTemplate): void => {
    setExpandedTemplateId((current) =>
      current === template.id ? null : template.id,
    );

    if (!controlValuesByTemplate[template.id]) {
      setControlValuesByTemplate((current) => ({
        ...current,
        [template.id]: getEditingTemplateDefaultControlValues(template),
      }));
    }
  };

  const handleControlChange = (
    templateId: string,
    controlId: string,
    value: EditingTemplatePrimitive,
  ): void => {
    setControlValuesByTemplate((current) => ({
      ...current,
      [templateId]: {
        ...(current[templateId] || {}),
        [controlId]: value,
      },
    }));
  };

  const handleApply = async (template: EditingTemplate): Promise<void> => {
    if (!selectedClip || !selectedTargetType) {
      toast.warning(
        "Select a clip",
        "Recipes apply to one selected video or image clip.",
      );
      return;
    }

    setApplyingTemplateId(template.id);
    try {
      const applicationId = applyEditingTemplate(
        template.id,
        selectedClip.id,
        controlValuesByTemplate[template.id] ||
          getEditingTemplateDefaultControlValues(template),
      );

      if (!applicationId) {
        toast.error(
          "Could not apply recipe",
          "This recipe could not be applied to the current clip.",
        );
        return;
      }

      toast.success(
        "Recipe applied",
        `${template.name} was added to ${selectedMedia?.name || "the selected clip"}.`,
      );
    } finally {
      setApplyingTemplateId(null);
    }
  };

  if (!selectedClip || !selectedTargetType) {
    return (
      <div className="h-full flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center space-y-3">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-background-tertiary border border-border shadow-inner text-text-muted">
          <Sparkles size={24} />
        </div>
        <div>
          <span className="text-fg-2 font-bold block text-sm">
            Select a clip first
          </span>
          <span className="text-fg-2 font-normal block mt-1.5 max-w-[240px] text-xs leading-relaxed mx-auto">
            Choose a video or image in the timeline to apply clip-scoped recipes, looks, and caption treatments.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background-secondary overflow-y-auto">
      {/* Target Info */}
      <div className="p-4 border-b border-border bg-background-secondary/80 backdrop-blur sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3 bg-background-tertiary rounded-xl p-2 pr-3 border border-border">
          <div className="w-10 h-10 rounded-lg bg-background-elevated flex items-center justify-center border border-border shrink-0">
            {selectedTargetType === 'video' ? <span className="text-primary/70 text-[10px]">VIDEO</span> : <span className="text-primary/70 text-[10px]">IMAGE</span>}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-fg-2 font-bold block truncate text-xs">
              {selectedMedia?.name || 'Selected Clip'}
            </span>
            <span className="text-fg-2 font-normal block mt-0.5 text-[10px]">
              {selectedClip.duration.toFixed(1)}s • {appliedTemplates.length} recipes applied
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <ShadcnInput
            value={searchQuery}
            placeholder="Search recipes..."
            aria-label={"Search recipes"}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            className={cn(
              "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
              "w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-background-tertiary text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 transition-colors md:text-xs",
            )}
          />
        </div>
      </div>

      <div className="px-4 py-3 border-b border-border/50 bg-background-secondary">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" type="button" aria-label="ALL" onClick={() => setSelectedCategory("all")} role="checkbox" aria-checked={selectedCategory === "all"} data-selected={(selectedCategory === "all") ? "true" : undefined} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (selectedCategory === "all" ? "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15" : "border-transparent bg-bg-2 text-fg hover:bg-bg-3"), (selectedCategory === "all") && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]", "p-1", `px-3 py-1.5 text-[10px] font-bold rounded-full transition-colors ${
              selectedCategory === "all"
                ? "bg-text-primary text-black"
                : "bg-background-tertiary text-text-muted hover:text-text-primary hover:bg-background-elevated border border-border/50"
            }`)}>
            ALL
          </Button>
          {EDITING_TEMPLATE_CATEGORIES.map((category) => (
            <Button variant="ghost" key={category.id} type="button" aria-label={category.name} onClick={() => setSelectedCategory(category.id)} role="checkbox" aria-checked={selectedCategory === category.id} data-selected={(selectedCategory === category.id) ? "true" : undefined} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (selectedCategory === category.id ? "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15" : "border-transparent bg-bg-2 text-fg hover:bg-bg-3"), (selectedCategory === category.id) && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]", "p-1", `px-3 py-1.5 text-[10px] font-bold rounded-full uppercase transition-colors ${
                selectedCategory === category.id
                  ? "bg-text-primary text-black"
                  : "bg-background-tertiary text-text-muted hover:text-text-primary hover:bg-background-elevated border border-border/50"
              }`)}>
              {category.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4 space-y-3">
        {filteredTemplates.length === 0 ? (
          <div className="py-12 text-center">
            <span className="text-fg-2 font-bold block text-sm">
              No recipes match
            </span>
            <span className="text-fg-2 font-normal block mt-2 text-xs">
              Try a different search or category.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filteredTemplates.map((template) => {
              const currentValues =
                controlValuesByTemplate[template.id] ||
                getEditingTemplateDefaultControlValues(template);
              const appliedCount = appliedTemplates.filter(
                (at) => at.templateId === template.id,
              ).length;
              const isExpanded = expandedTemplateId === template.id;
              const CategoryIcon = CATEGORY_ICONS[template.category] ?? Wand2;

              return (
                <div
                  key={template.id}
                  className="rounded-xl border border-border bg-background-tertiary/50 transition-all hover:bg-background-tertiary overflow-hidden group shadow-sm hover:border-primary/30"
                >
                  <div className="p-3">
                    <div className="flex gap-3">
                      <div className="w-12 h-12 rounded-lg bg-background-elevated border border-border/60 flex items-center justify-center shrink-0 shadow-inner group-hover:border-primary/30 transition-colors">
                        <CategoryIcon size={18} className={`${appliedCount > 0 ? 'text-primary' : 'text-text-muted'}`} />
                      </div>
                      
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-fg-2 font-bold block truncate text-xs leading-tight">
                              {template.name}
                            </span>
                            {appliedCount > 0 && (
                              <span className="shrink-0 flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary ring-1 ring-primary/20">
                                <CheckCircle2 size={10} />
                                {appliedCount}x
                              </span>
                            )}
                          </div>
                          <span className="text-fg-2 font-normal mt-0.5 line-clamp-2 text-[10px] leading-relaxed">
                            {template.description}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between mt-2.5">
                          <span className="text-[9px] uppercase tracking-wider text-text-muted font-medium">
                            {formatCategoryLabel(template.category)}
                          </span>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {template.controls && template.controls.length > 0 && (
                              <Button onClick={() => handleExpand(template)} type="button" aria-label="Edit recipe controls" className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-8 px-3 text-[12px]", "bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg", `h-6 px-2 text-[10px] font-medium rounded transition-colors flex items-center gap-1.5 ${
                                  isExpanded
                                    ? "bg-primary/20 text-primary border border-primary/30"
                                    : "bg-background-secondary border border-border hover:text-text-primary text-text-secondary"
                                  }`)}>
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<SlidersHorizontal size={10} />}</span>
                                <span className="truncate">{"Edit recipe controls"}</span>
                              </Button>
                            )}
                            <Button onClick={() => void handleApply(template)} type="button" aria-label={(applyingTemplateId === template.id ? "Applying" : "Apply").trim() || undefined} disabled={(applyingTemplateId !== null)} className="inline-flex min-w-0 items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none h-6 px-3 bg-primary text-black text-[10px] font-bold rounded transition-colors hover:bg-primary/80 disabled:opacity-50">
                              <span className="truncate">{applyingTemplateId === template.id ? "Applying" : "Apply"}</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Controls */}
                  {isExpanded && template.controls && template.controls.length > 0 && (
                    <div className="px-3 pb-4 pt-1 bg-background-tertiary border-t border-border/50">
                       {/* Inject small padding wrapper to give space */}
                       <div className="space-y-3 pt-3">
                        <EditingTemplateControls
                          template={template}
                          values={currentValues}
                          onChange={(controlId, value) =>
                            handleControlChange(template.id, controlId, value)
                          }
                        />
                       </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
