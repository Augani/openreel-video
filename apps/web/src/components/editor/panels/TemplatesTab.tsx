import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Search, Layout, Clock } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useRouter } from "../../../hooks/use-router";
import type {
  TemplateSummary,
  TemplateCategory,
} from "@openreel/core";
import { TEMPLATE_CATEGORIES } from "@openreel/core";
import { useTranslation } from "react-i18next";

export const TemplatesTab: React.FC = () => {
  const { t: tr } = useTranslation();
  const getTemplateEngine = useEngineStore((s) => s.getTemplateEngine);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | TemplateCategory
  >("all");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const { navigate } = useRouter();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const engine = await getTemplateEngine();
      await engine.initialize();
      const list = await engine.listTemplates();
      if (!cancelled) {
        setTemplates(list);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [getTemplateEngine]);

  const filteredTemplates = useMemo(() => {
    let result = templates;
    if (selectedCategory !== "all") {
      result = result.filter((t) => t.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }
    return result;
  }, [templates, selectedCategory, searchQuery]);

  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      const hasClips =
        useProjectStore.getState().project.timeline.tracks.length > 0;
      if (hasClips) {
        const confirmed = window.confirm(
          "Applying a template will replace your current project. Continue?",
        );
        if (!confirmed) return;
      }

      setApplying(templateId);
      try {
        const engine = await getTemplateEngine();
        const template = await engine.loadTemplate(templateId);
        if (!template) return;

        const result = engine.applyTemplate(template, {});
        useProjectStore.setState(() => ({
          project: { ...result.project, modifiedAt: Date.now() },
        }));
      } finally {
        setApplying(null);
      }
    },
    [getTemplateEngine],
  );

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-xs">
        {tr("Loading templates...")}</div>
    );
  }

  return (
    <div className="px-5 py-4 space-y-3 flex-1 min-h-0 h-full overflow-y-auto bg-background-secondary">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <ToolcraftTextInputControl
          label={tr("Search templates")}
          isLabelHidden
          placeholder={tr("Search templates...")}
          value={searchQuery}
          onChange={setSearchQuery}
          className="w-full pl-8 pr-3 py-2 text-xs bg-background-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50"
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <SelectableCard
          label={tr("All")}
          isSelected={selectedCategory === "all"}
          onChange={() => setSelectedCategory("all")}
          onClick={() => setSelectedCategory("all")}
          padding={1}
          variant={selectedCategory === "all" ? "green" : "muted"}
          className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
            selectedCategory === "all"
              ? "bg-primary/20 border-primary text-primary"
              : "bg-background-tertiary border-border text-text-muted hover:border-primary/50"
          }`}
        >
          {tr("All")}</SelectableCard>
        {TEMPLATE_CATEGORIES.slice(0, 6).map((cat) => (
          <SelectableCard
            key={cat.id}
            label={tr(cat.name)}
            isSelected={selectedCategory === cat.id}
            onChange={() => setSelectedCategory(cat.id)}
            onClick={() => setSelectedCategory(cat.id)}
            padding={1}
            variant={selectedCategory === cat.id ? "green" : "muted"}
            className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
              selectedCategory === cat.id
                ? "bg-primary/20 border-primary text-primary"
                : "bg-background-tertiary border-border text-text-muted hover:border-primary/50"
            }`}
          >
            {cat.name}
          </SelectableCard>
        ))}
      </div>

      <button
        type="button"
        aria-label={tr("Start a Motion Creator template")}
        className="flex min-h-[72px] w-full min-w-0 items-center gap-3 rounded-lg border border-primary/35 bg-primary/10 p-3 text-left transition-colors hover:bg-primary/15"
        onClick={async () => {
          const composition = await createMotionComposition(
            "Motion Template Scene",
            "motion-ad-card",
          );
          if (composition) {
            navigate("motion", { compositionId: composition.id });
          }
        }}
      >
        <span className="grid h-10 w-10 place-items-center rounded-md bg-primary text-white">
          <Box size={18} />
        </span>
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="block truncate text-xs font-semibold text-text-primary">
            {tr("Start a Motion Creator template")}</span>
          <span className="mt-0.5 block overflow-hidden text-ellipsis text-[10px] leading-4 text-text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {tr("Ads, app UI demos, lower thirds, social hooks, logo reveals, and end screens.")}</span>
        </span>
      </button>

      {filteredTemplates.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-xs">
          {tr("No templates found")}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template) => (
            <Button
              key={template.id}
              label={tr(template.name)}
              variant="ghost"
              onClick={() => handleApplyTemplate(template.id)}
              isDisabled={applying !== null}
              className="group relative flex flex-col p-3 bg-background-tertiary border border-border rounded-lg hover:border-primary/50 transition-all text-left disabled:opacity-50"
            >
              <div className="w-full aspect-video bg-background-secondary rounded mb-2 flex items-center justify-center">
                {template.thumbnailUrl ? (
                  <img
                    src={template.thumbnailUrl}
                    alt={tr(template.name)}
                    className="w-full h-full object-cover rounded"
                  />
                ) : (
                  <Layout size={20} className="text-text-muted" />
                )}
              </div>
              <span className="text-[10px] font-medium text-text-primary truncate w-full">
                {template.name}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-text-muted capitalize">
                  {template.category.replace("-", " ")}
                </span>
                <span className="flex items-center gap-0.5 text-[9px] text-text-muted">
                  <Clock size={8} />
                  {formatDuration(template.duration)}
                </span>
              </div>
              {applying === template.id && (
                <div className="absolute inset-0 bg-background-primary/80 rounded-lg flex items-center justify-center">
                  <span className="text-[10px] text-primary">{tr("Applying...")}</span>
                </div>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
