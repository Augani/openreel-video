import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Search, Loader2, Layers } from "@/icons/lucide-compat";
import { Alert, AlertDescription, Button, Input } from "@openreel/ui";
import {
  SOCIAL_MEDIA_CATEGORY_INFO,
  type SocialMediaCategory,
  type ScriptableTemplate,
} from "@openreel/core";
import { useEngineStore } from "../../stores/engine-store";
import { templateCloudService } from "../../services/template-cloud-service";
import {
  catalogFromSummary,
  catalogFromTemplate,
  mergeTemplateCatalog,
  toScriptableTemplate,
  type TemplateCatalogEntry,
} from "../../services/template-catalog";
import { CategoryTabs } from "./CategoryTabs";
import { TemplateCard } from "./TemplateCard";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

interface Props {
  onTemplateApplied?: () => void;
}
export function TemplateGallery({ onTemplateApplied }: Props) {
  const getEngine = useEngineStore((state) => state.getTemplateEngine);
  const [entries, setEntries] = useState<TemplateCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState<SocialMediaCategory | "all">("all");
  const [selected, setSelected] = useState<ScriptableTemplate | null>(null),
    [selecting, setSelecting] = useState<string | null>(null);
  const selection = useRef(0);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    const requests = selection,
      controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const engine = await getEngine();
        await engine.initialize();
        if (cancelled) return;
        const builtins = engine
          .getBuiltinTemplates()
          .map((template) =>
            catalogFromTemplate(toScriptableTemplate(template), "builtin"),
          );
        setEntries(builtins);
        setLoading(false);
        await Promise.allSettled([
          engine
            .listTemplates()
            .then((summaries) => {
              if (!cancelled)
                setEntries((current) =>
                  mergeTemplateCatalog(
                    current,
                    summaries
                      .filter(
                        (item) =>
                          !builtins.some((builtin) => builtin.id === item.id),
                      )
                      .map(catalogFromSummary),
                  ),
                );
            })
            .catch((reason) => {
              if (!cancelled)
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Failed to load local templates",
                );
            }),
          templateCloudService
            .listScriptableTemplates({ signal: controller.signal })
            .then((templates) => {
              if (!cancelled)
                setEntries((current) =>
                  mergeTemplateCatalog(
                    current,
                    templates.map((template) =>
                      catalogFromTemplate(template, "cloud"),
                    ),
                  ),
                );
            }),
        ]);
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Failed to load templates",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      requests.current++;
    };
  }, [getEngine, refresh]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (category === "all" || entry.socialCategory === category) &&
        (!search ||
          [entry.name, entry.description, ...entry.tags].some((text) =>
            text.toLowerCase().includes(search),
          )),
    );
  }, [entries, category, query]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(filtered.length / 48)),
    activePage = Math.min(page, pages - 1);
  const stats = useMemo(() => {
    const next: Record<string, number> = { all: entries.length };
    for (const info of SOCIAL_MEDIA_CATEGORY_INFO)
      next[info.id] = entries.filter(
        (entry) => entry.socialCategory === info.id,
      ).length;
    return next;
  }, [entries]);
  const choose = useCallback(
    async (entry: TemplateCatalogEntry) => {
      selectionTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const request = ++selection.current;
      setSelecting(entry.id);
      setError(null);
      try {
        let template = entry.template;
        if (!template) {
          const engine = await getEngine(),
            saved = await engine.loadTemplate(entry.id);
          if (saved) template = toScriptableTemplate(saved);
        }
        if (request !== selection.current) return;
        if (!template) throw new Error("Template not found");
        setSelected(template);
      } catch (reason) {
        if (request === selection.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Failed to load template",
          );
      } finally {
        if (request === selection.current) setSelecting(null);
      }
    },
    [getEngine],
  );
  const close = useCallback(() => {
    selection.current++;
    setSelected(null);
    requestAnimationFrame(() => {
      if (selectionTrigger.current?.isConnected)
        selectionTrigger.current.focus();
    });
  }, []);
  const applied = useCallback(() => {
    close();
    onTemplateApplied?.();
  }, [close, onTemplateApplied]);
  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-fg-3"
        />
        <Input
          aria-label="Search templates"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Search templates..."
          className="h-10 w-full rounded-xl border-border bg-bg-2 pl-11 text-fg"
        />
      </div>
      <CategoryTabs
        selectedCategory={category}
        onSelectCategory={(next) => {
          setCategory(next);
          setPage(0);
        }}
        categoryStats={stats}
      />
      {error && (
        <Alert
          variant="destructive"
          className="border-red-500/30 bg-red-500/10 text-red-400"
        >
          <AlertDescription>{error}</AlertDescription>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
            className="mt-2 h-8 text-xs"
          >
            Retry loading templates
          </Button>
        </Alert>
      )}
      {loading ? (
        <p
          role="status"
          className="flex items-center justify-center gap-3 py-20 text-sm text-fg-3"
        >
          <Loader2 size={24} aria-hidden className="animate-spin" />
          Loading templates...
        </p>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Layers size={24} aria-hidden className="mb-4 text-fg-3" />
          <p className="mb-1 text-base font-medium text-fg">
            No templates found
          </p>
          <p className="text-sm text-fg-3">
            Try adjusting your search or filter
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filtered
            .slice(activePage * 48, (activePage + 1) * 48)
            .map((entry) => (
              <TemplateCard
                key={entry.id}
                template={entry}
                isLoading={selecting === entry.id}
                onClick={choose}
              />
            ))}
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-fg-3">
          <Button
            variant="ghost"
            type="button"
            disabled={activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            Previous templates
          </Button>
          <span>
            {activePage + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            type="button"
            disabled={activePage + 1 >= pages}
            onClick={() => setPage(activePage + 1)}
          >
            Next templates
          </Button>
        </div>
      )}
      {selected && (
        <TemplatePreviewModal
          template={selected}
          onClose={close}
          onApply={applied}
        />
      )}
    </div>
  );
}
