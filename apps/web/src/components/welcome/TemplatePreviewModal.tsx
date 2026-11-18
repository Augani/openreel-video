import { TemplateHero } from "./TemplateHero";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Alert,
  AlertDescription,
} from "@openreel/ui";
import {
  ChevronRight,
  Loader2,
  RotateCcw,
  X,
} from "@/icons/lucide-compat";
import type { ExtendedPlaceholder, ScriptableTemplate } from "@openreel/core";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import {
  openTemplateProject,
  resolveTemplateMedia,
} from "../../services/project-templates";
import {
  buildTemplateReplacements,
  orderedTemplateFields,
  type TemplateFieldDraft,
  type TemplateFieldDrafts,
} from "../../services/template-customization";
import type { EditorDraftOwner } from "../../services/editor-field-drafts";
import { TemplatePlaceholderField } from "./TemplatePlaceholderField";

interface Props {
  template: ScriptableTemplate;
  onClose: () => void;
  onApply: () => void;
}
const formatDuration = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;

export function TemplatePreviewModal(props: Props) {
  const owner = useProjectStore(
    useShallow((state) => ({
      projectId: state.project.id,
      history: state.actionHistory,
    })),
  );
  const session = useRef({ template: props.template, owner, key: 0 });
  if (
    session.current.template !== props.template ||
    session.current.owner.projectId !== owner.projectId ||
    session.current.owner.history !== owner.history
  )
    session.current = {
      template: props.template,
      owner,
      key: session.current.key + 1,
    };
  return (
    <TemplateCustomizationSession
      key={session.current.key}
      {...props}
      owner={owner}
    />
  );
}

function TemplateCustomizationSession({
  template,
  owner,
  onClose,
  onApply,
}: Props & { owner: EditorDraftOwner }) {
  const getEngine = useEngineStore((state) => state.getTemplateEngine);
  const { track } = useAnalytics();
  const [drafts, setDrafts] = useState<TemplateFieldDrafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const closed = useRef(false);
  const opener = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const body = useRef<HTMLDivElement>(null);
  const [errorTarget, setErrorTarget] = useState<string | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const groups = useMemo(() => {
    const fields = orderedTemplateFields(template.placeholders);
    return {
      main: fields.filter((field) => !field.uiHints?.advanced),
      advanced: fields.filter((field) => field.uiHints?.advanced),
    };
  }, [template.placeholders]);
  const change = useCallback((id: string, value: TemplateFieldDraft) => {
    if (operation.current) return;
    setDrafts((current) => ({ ...current, [id]: value }));
    setErrors((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const reset = useCallback((id: string) => {
    if (operation.current) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const close = () => {
    closed.current = true;
    operation.current?.abort();
    onClose();
  };

  useEffect(() => {
    if (!errorTarget) return;
    const frame = requestAnimationFrame(() => {
      const field = Array.from(
        body.current?.querySelectorAll<HTMLElement>("[data-template-field]") ??
          [],
      ).find((item) => item.dataset.templateField === errorTarget);
      field
        ?.querySelector<HTMLElement>(
          "input, textarea, [role=combobox], [role=switch]",
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [errorTarget, advanced]);

  async function apply() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setErrors({});
    setErrorTarget(null);
    try {
      const engine = await getEngine();
      controller.signal.throwIfAborted();
      const decoded = buildTemplateReplacements(
        template.placeholders,
        drafts,
        (field, value) => engine.validatePlaceholderValue(field, value),
      );
      if (Object.keys(decoded.errors).length) {
        setErrors(decoded.errors);
        const first = template.placeholders.find(
          (field) => decoded.errors[field.id],
        );
        if (first?.uiHints?.advanced) setAdvanced(true);
        setErrorTarget(first?.id ?? null);
        return;
      }
      const values = await resolveTemplateMedia(
        decoded.replacements,
        owner,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const { project, result } = engine.applyScriptableTemplate(
        template,
        values,
      );
      if (!result.success) {
        if (result.errors.length)
          setErrors(
            Object.fromEntries(
              result.errors.map((item) => [item.placeholderId, item.message]),
            ),
          );
        throw new Error(
          result.errors.map((item) => item.message).join(", ") ||
            "Failed to apply template",
        );
      }
      const opened = await openTemplateProject(
        project,
        owner,
        controller.signal,
      );
      // Publishing our own project replaces this form's owner. Its cleanup abort
      // must not swallow the successful completion that closes the gallery.
      if (closed.current || useProjectStore.getState().project.id !== opened.id)
        return;
      track(AnalyticsEvents.TEMPLATE_USED, {
        templateId: template.id,
        templateName: template.name,
        category: template.category,
        placeholderCount: template.placeholders.length,
      });
      onApply();
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Failed to apply template",
        );
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        hideCloseButton
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg shadow-xl"
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader className="shrink-0 flex-row items-start gap-3 space-y-0 border-b border-border px-5 py-4 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] font-semibold leading-5 text-fg">
              {template.name}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-4 text-fg-muted">
              {formatDuration(template.timeline.duration)} ·{" "}
              {template.placeholders.length} editable{" "}
              {template.placeholders.length === 1 ? "field" : "fields"}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="Close dialog"
            onClick={close}
            className="h-7 w-7 shrink-0 max-sm:h-11 max-sm:w-11"
          >
            <X size={15} aria-hidden />
          </Button>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            ref={body}
            className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 md:grid-cols-2"
          >
            <div className="min-w-0 space-y-4">
              <Card className="aspect-video overflow-hidden rounded-xl border-border bg-bg-2 shadow-none">
                <TemplateHero template={template} />
              </Card>
              {template.description && (
                <p className="text-sm text-fg-2">{template.description}</p>
              )}
              {!!template.scenes?.length && (
                <section className="space-y-2" aria-label="Scenes">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-fg-3">
                    Scenes
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {template.scenes.map((scene) => (
                      <Card
                        key={scene.id}
                        className="flex items-center gap-2 rounded-lg border-border bg-bg-2 px-3 py-1.5 text-xs shadow-none"
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: scene.color || "#22c55e" }}
                        />
                        <span className="text-fg-2">{scene.label}</span>
                        <span className="text-fg-3">
                          ({formatDuration(scene.endTime - scene.startTime)})
                        </span>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-fg">
                  Customize Template
                </h3>
                {!!Object.keys(drafts).length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!operation.current) {
                        setDrafts({});
                        setErrors({});
                        setError(null);
                      }
                    }}
                    className="h-7 gap-1 text-xs"
                  >
                    <RotateCcw size={12} aria-hidden />
                    Reset all
                  </Button>
                )}
              </div>
              <TemplateFieldList
                fields={groups.main}
                drafts={drafts}
                errors={errors}
                disabled={busy}
                errorTarget={errorTarget}
                onChange={change}
                onReset={reset}
                label="Main fields"
              />
              {!!groups.advanced.length && (
                <Collapsible open={advanced} onOpenChange={setAdvanced}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      className="h-8 gap-1.5 px-0 text-xs text-fg-3"
                    >
                      <ChevronRight
                        size={12}
                        aria-hidden
                        className={advanced ? "rotate-90" : ""}
                      />
                      Advanced Options ({groups.advanced.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 border-l border-border pl-3">
                    <TemplateFieldList
                      fields={groups.advanced}
                      drafts={drafts}
                      errors={errors}
                      disabled={busy}
                      errorTarget={errorTarget}
                      onChange={change}
                      onReset={reset}
                      label="Advanced fields"
                    />
                  </CollapsibleContent>
                </Collapsible>
              )}
              {error && (
                <Alert
                  variant="destructive"
                  className="border-red-500/30 bg-red-500/10 p-3 text-red-400"
                >
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {!template.placeholders.length && (
                <p className="text-xs text-fg-3">
                  This template has no editable fields.
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-4 sm:space-x-0">
            <Button
              variant="ghost"
              type="button"
              onClick={close}
              className="h-8 px-3 text-xs max-sm:min-h-11"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-8 gap-1.5 px-3 text-xs max-sm:min-h-11"
            >
              {busy ? (
                <Loader2 size={16} aria-hidden className="animate-spin" />
              ) : (
                <ChevronRight size={16} aria-hidden />
              )}
              {busy ? "Applying..." : "Use Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateFieldList({
  fields,
  drafts,
  errors,
  disabled,
  errorTarget,
  onChange,
  onReset,
  label,
}: {
  fields: ExtendedPlaceholder[];
  drafts: TemplateFieldDrafts;
  errors: Record<string, string>;
  disabled: boolean;
  errorTarget: string | null;
  onChange: (id: string, value: TemplateFieldDraft) => void;
  onReset: (id: string) => void;
  label: string;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    const index = fields.findIndex((field) => field.id === errorTarget);
    if (index >= 0) setPage(Math.floor(index / 50));
  }, [fields, errorTarget]);
  const pages = Math.max(1, Math.ceil(fields.length / 50)),
    activePage = Math.min(page, pages - 1),
    visible = fields.slice(activePage * 50, (activePage + 1) * 50);
  return (
    <div className="space-y-4">
      {visible.map((field, index) => (
        <div key={field.id} className="space-y-2">
          {field.uiHints?.group &&
            (index === 0 ||
              field.uiHints.group !== visible[index - 1].uiHints?.group) && (
              <h4 className="text-xs font-medium text-fg-2">
                {field.uiHints.group}
              </h4>
            )}
          <TemplatePlaceholderField
            field={field}
            draft={drafts[field.id]}
            error={errors[field.id]}
            disabled={disabled}
            onChange={onChange}
            onReset={onReset}
          />
        </div>
      ))}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-fg-3">
          <Button
            variant="ghost"
            type="button"
            aria-label={`Previous ${label.toLowerCase()} page`}
            disabled={disabled || activePage === 0}
            onClick={() => setPage(activePage - 1)}
          >
            Previous
          </Button>
          <span>
            {activePage + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            type="button"
            aria-label={`Next ${label.toLowerCase()} page`}
            disabled={disabled || activePage + 1 >= pages}
            onClick={() => setPage(activePage + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
