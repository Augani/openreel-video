import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Layout, Clock } from "lucide-react";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import type {
  TemplateSummary,
  TemplateCategory,
} from "@openreel/core";
import { TEMPLATE_CATEGORIES } from "@openreel/core";

export const TemplatesTab: React.FC = () => {
  const getTemplateEngine = useEngineStore((s) => s.getTemplateEngine);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | TemplateCategory
  >("all");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

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
        Loading templates...
      </div>
    );
  }

  return (
    <div className="px-5 py-4 space-y-3 flex-1 min-h-0 h-full overflow-y-auto bg-background-secondary">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-xs bg-background-secondary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary/50"
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => setSelectedCategory("all")}
          className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
            selectedCategory === "all"
              ? "bg-primary/20 border-primary text-primary"
              : "bg-background-tertiary border-border text-text-muted hover:border-primary/50"
          }`}
        >
          All
        </button>
        {TEMPLATE_CATEGORIES.slice(0, 6).map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
              selectedCategory === cat.id
                ? "bg-primary/20 border-primary text-primary"
                : "bg-background-tertiary border-border text-text-muted hover:border-primary/50"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-xs">
          No templates found
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleApplyTemplate(template.id)}
              disabled={applying !== null}
              className="group relative flex flex-col p-3 bg-background-tertiary border border-border rounded-lg hover:border-primary/50 transition-all text-left disabled:opacity-50"
            >
              <div className="w-full aspect-video bg-background-secondary rounded mb-2 flex items-center justify-center">
                {template.thumbnailUrl ? (
                  <img
                    src={template.thumbnailUrl}
                    alt={template.name}
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
                  <span className="text-[10px] text-primary">Applying...</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
