import { TemplateThumb } from "../../welcome/TemplateThumb";
import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Clock, Loader2 } from "@/icons/lucide-compat";
import {
  Button,
  Input,
  ToggleGroup,
  ToggleGroupItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import {
  TEMPLATE_CATEGORIES,
  type Template,
  type TemplateSummary,
  type TemplateCategory,
  type TemplateReplacements,
} from "@openreel/core";
import { TemplateVariablesPanel } from "../inspector/TemplateVariablesPanel";
import {
  openTemplateProject,
  resolveTemplateMedia,
  templateEditorOwner,
} from "../../../services/project-templates";

export function TemplatesTab() {
  const getTemplateEngine = useEngineStore((state) => state.getTemplateEngine);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | TemplateCategory
  >("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<TemplateReplacements>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);
  const application = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requests = selection;
    void (async () => {
      try {
        const engine = await getTemplateEngine();
        await engine.initialize();
        const list = await engine.listTemplates();
        if (!cancelled) setTemplates(list);
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
      requests.current++;
      application.current?.abort();
    };
  }, [getTemplateEngine]);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return templates.filter(
      (template) =>
        (selectedCategory === "all" ||
          template.category === selectedCategory) &&
        (!query || template.name.toLowerCase().includes(query)),
    );
  }, [templates, selectedCategory, searchQuery]);

  async function choose(templateId: string) {
    if (application.current) return;
    const request = ++selection.current;
    setError(null);
    try {
      const engine = await getTemplateEngine();
      const template = await engine.loadTemplate(templateId);
      if (request !== selection.current) return;
      if (!template) throw new Error("Template not found");
      setValues({});
      setSelected(template);
    } catch (reason) {
      if (request === selection.current)
        setError(
          reason instanceof Error ? reason.message : "Failed to load template",
        );
    }
  }

  async function apply() {
    if (!selected || application.current) return;
    const controller = new AbortController(),
      owner = templateEditorOwner();
    application.current = controller;
    setApplying(true);
    setError(null);
    try {
      const engine = await getTemplateEngine();
      const replacements = await resolveTemplateMedia(
        values,
        owner,
        controller.signal,
      );
      const result = engine.applyTemplate(selected, replacements);
      if (result.missingPlaceholders.length)
        throw new Error(
          `Missing required: ${result.missingPlaceholders.join(", ")}`,
        );
      await openTemplateProject(result.project, owner, controller.signal);
      if (!controller.signal.aborted) setSelected(null);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Failed to apply template",
        );
    } finally {
      if (application.current === controller) application.current = null;
      if (!controller.signal.aborted) setApplying(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full space-y-3 overflow-y-auto bg-bg-1 px-5 py-4">
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
        />
        <Input
          aria-label="Search templates"
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-9 w-full rounded-lg border-border bg-bg-2 pl-8 pr-3 text-xs text-fg"
        />
      </div>
      <ToggleGroup
        type="single"
        aria-label="Template category"
        value={selectedCategory}
        onValueChange={(value) => {
          if (value) setSelectedCategory(value as typeof selectedCategory);
        }}
        className="flex flex-wrap justify-start gap-1.5"
      >
        {[{ id: "all", name: "All" }, ...TEMPLATE_CATEGORIES].map(
          (category) => (
            <ToggleGroupItem
              key={category.id}
              value={category.id}
              aria-label={category.name}
              className="h-7 rounded-full border border-border bg-bg-2 px-2.5 text-[10px] text-fg-3 data-[state=on]:border-primary data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
            >
              {category.name}
            </ToggleGroupItem>
          ),
        )}
      </ToggleGroup>
      {error && !selected && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-12 text-center text-xs text-fg-3">
          Loading templates...
        </p>
      ) : !filteredTemplates.length ? (
        <p className="py-8 text-center text-xs text-fg-3">No templates found</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filteredTemplates.map((template) => (
            <Button
              variant="ghost"
              key={template.id}
              onClick={() => void choose(template.id)}
              disabled={applying}
              type="button"
              aria-label={template.name}
              className="group relative flex h-auto min-w-0 flex-col items-start whitespace-normal rounded-lg border border-border bg-bg-2 p-3 text-left hover:border-primary/50"
            >
              <span className="mb-2 block aspect-video w-full overflow-hidden rounded bg-bg-1">
                <TemplateThumb template={template} />
              </span>
              <span className="w-full truncate text-[10px] font-medium text-fg">
                {template.name}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-fg-3">
                <span className="capitalize">
                  {template.category.replace("-", " ")}
                </span>
                <span className="flex items-center gap-0.5">
                  <Clock size={8} aria-hidden />
                  {Math.floor(template.duration / 60) > 0
                    ? `${Math.floor(template.duration / 60)}:${Math.floor(
                        template.duration % 60,
                      )
                        .toString()
                        .padStart(2, "0")}`
                    : `${Math.round(template.duration)}s`}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !application.current) {
            selection.current++;
            setSelected(null);
            setError(null);
          }
        }}
      >
        <DialogContent
          hideCloseButton={applying}
          className="max-h-[85dvh] max-w-lg overflow-y-auto border-border bg-bg-1"
          onEscapeKeyDown={(event) => {
            if (applying) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (applying) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              Your current project will be saved in Recents before this template
              opens as a new project.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}
          <TemplateVariablesPanel
            template={selected}
            values={values}
            onChange={setValues}
            onApply={() => void apply()}
            isApplying={applying}
          />
          <Button
            variant="outline"
            type="button"
            disabled={applying}
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
          >
            Cancel
          </Button>
          {applying && (
            <span
              role="status"
              className="flex items-center gap-2 text-xs text-fg-3"
            >
              <Loader2 size={12} aria-hidden className="animate-spin" />
              Saving and opening template...
            </span>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
