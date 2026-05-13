import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
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
      <div className="px-5 py-6 space-y-4">
        <div className="rounded-2xl border border-dashed border-border bg-background-tertiary/60 px-4 py-5 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles size={18} />
          </div>
          <p className="text-sm font-semibold text-text-primary">
            Choose a video or image clip
          </p>
          <p className="mt-2 text-xs leading-5 text-text-muted">
            Recipes are clip-scoped. Select a single clip in the timeline, then
            apply a look, caption treatment, or overlay stack without replacing
            the rest of the project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="rounded-2xl border border-border bg-background-tertiary/70 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Target Clip
            </p>
            <p className="mt-1 text-sm font-semibold text-text-primary">
              {selectedMedia?.name || selectedClip.id}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {selectedTargetType === "video" ? "Video clip" : "Image clip"}
              {` • ${selectedClip.duration.toFixed(2)}s`}
            </p>
          </div>
          <div className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
            {appliedTemplates.length} applied
          </div>
        </div>
      </div>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search recipes"
          className="h-10 w-full rounded-xl border border-border bg-background-secondary pl-9 pr-3 text-xs text-text-primary placeholder:text-text-muted transition-colors focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory("all")}
          className={`rounded-full border px-3 py-1.5 text-[10px] font-medium capitalize transition-colors ${
            selectedCategory === "all"
              ? "border-primary bg-primary/12 text-primary"
              : "border-border bg-background-tertiary text-text-muted hover:border-primary/30 hover:text-text-primary"
          }`}
        >
          All Recipes
        </button>
        {EDITING_TEMPLATE_CATEGORIES.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-medium capitalize transition-colors ${
              selectedCategory === category.id
                ? "border-primary bg-primary/12 text-primary"
                : "border-border bg-background-tertiary text-text-muted hover:border-primary/30 hover:text-text-primary"
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background-tertiary/60 px-4 py-8 text-center">
          <p className="text-sm font-medium text-text-primary">No recipes match</p>
          <p className="mt-2 text-xs text-text-muted">
            Try a different search or category.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-4">
          {filteredTemplates.map((template) => {
            const currentValues =
              controlValuesByTemplate[template.id] ||
              getEditingTemplateDefaultControlValues(template);
            const appliedCount = appliedTemplates.filter(
              (appliedTemplate) => appliedTemplate.templateId === template.id,
            ).length;
            const isExpanded = expandedTemplateId === template.id;

            return (
              <div
                key={template.id}
                className="rounded-2xl border border-border bg-background-tertiary/70 p-4 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {template.name}
                      </p>
                      {appliedCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          <CheckCircle2 size={10} />
                          {appliedCount}x
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      {template.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-border bg-background-secondary px-2 py-1 text-[10px] font-medium text-text-secondary capitalize">
                        {formatCategoryLabel(template.category)}
                      </span>
                      {template.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-background-secondary px-2 py-1 text-[10px] text-text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {template.controls && template.controls.length > 0 && (
                      <button
                        onClick={() => handleExpand(template)}
                        className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[11px] font-medium transition-colors ${
                          isExpanded
                            ? "border-primary bg-primary/12 text-primary"
                            : "border-border bg-background-secondary text-text-secondary hover:border-primary/30 hover:text-text-primary"
                        }`}
                      >
                        <SlidersHorizontal size={13} />
                        Controls
                      </button>
                    )}
                    <button
                      onClick={() => void handleApply(template)}
                      disabled={applyingTemplateId !== null}
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-[11px] font-semibold text-black transition-all hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Wand2 size={13} />
                      {applyingTemplateId === template.id ? "Applying" : "Apply"}
                    </button>
                  </div>
                </div>

                {isExpanded && template.controls && template.controls.length > 0 && (
                  <div className="mt-4 space-y-3 rounded-2xl border border-border/80 bg-background-secondary/80 p-4">
                    <EditingTemplateControls
                      template={template}
                      values={currentValues}
                      onChange={(controlId, value) =>
                        handleControlChange(template.id, controlId, value)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};