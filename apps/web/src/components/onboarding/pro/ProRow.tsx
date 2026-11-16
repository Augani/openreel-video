import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@openreel/ui";
import { FileUp, FolderOpen, SlidersHorizontal } from "@/icons/lucide-compat";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { openEditorProject } from "../../../services/project-replacement";
import { openTimelineImport, useTimelineImportStore } from "../../../services/timeline-interchange";
import { chooseOnboardingWorkspace, isOnboardingWorkspace, ONBOARDING_WORKSPACES } from "../../../services/workspace-apply";
import { useOnboardingStore } from "../../../stores/onboarding-store";
import { describePresetDiff, KEYMAP_CHOICES } from "./preset-caption";

export interface ProRowProps {
  /** Go to the editor route (the welcome screen's `navigate("editor")`). */
  onOpenEditor: () => void;
  /** Move focus to the first keymap chip on mount (when the band expands this row from its tile). */
  autoFocus?: boolean;
  className?: string;
}

const chipClass =
  "h-8 rounded-lg border border-border bg-bg-2 px-3 text-xs font-medium text-fg-2 transition-colors " +
  "hover:bg-bg-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
  "data-[state=on]:border-accent/50 data-[state=on]:bg-accent-soft data-[state=on]:text-fg";

const actionClass =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-2 px-3 py-1.5 " +
  "text-left text-xs font-semibold text-fg-2 transition-colors hover:border-accent/40 hover:bg-bg-3 hover:text-fg " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50";

/**
 * "I already edit" row (spec 2.3): keymap and workspace chips, import / open buttons and the custom
 * sequence dialog. Everything here works before the editor exists. Rendered inline by the welcome screen.
 */
export function ProRow({ onOpenEditor, autoFocus = false, className }: ProRowProps) {
  const labelId = useId();
  const keysId = useId();
  const workspaceId = useId();
  const firstChip = useRef<HTMLButtonElement | null>(null);

  const [keymap, setKeymap] = useState<string>(() => keyboardShortcuts.getActivePreset());
  const [workspace, setWorkspace] = useState<string>(() => {
    const stored = useOnboardingStore.getState().workspace;
    return isOnboardingWorkspace(stored) ? stored : "editing";
  });
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) firstChip.current?.focus();
  }, [autoFocus]);

  const diff = useMemo(() => keyboardShortcuts.presetDiff(keymap), [keymap]);

  const pickKeymap = useCallback((id: string) => {
    // ToggleGroup reports "" when the active chip is clicked again; a keymap is always selected.
    if (!id) return;
    keyboardShortcuts.applyPreset(id);
    const onboarding = useOnboardingStore.getState();
    onboarding.start("pro");
    onboarding.setKeymap(id);
    setKeymap(id);
    setShowAll(false);
  }, []);

  const pickWorkspace = useCallback((id: string) => {
    if (!id || !chooseOnboardingWorkspace(id)) return;
    useOnboardingStore.getState().start("pro");
    setWorkspace(id);
  }, []);

  const finish = useCallback(() => {
    useOnboardingStore.getState().markDone();
    onOpenEditor();
  }, [onOpenEditor]);

  // Import: the picker runs first, the editor hosts the relink report, so go there once a file was read.
  const stopWaiting = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWaiting.current?.(), []);
  const importTimeline = useCallback(() => {
    setError(null);
    stopWaiting.current?.();
    useOnboardingStore.getState().start("pro");
    const unsubscribe = useTimelineImportStore.subscribe((state) => {
      if (!state.preview) return;
      unsubscribe();
      stopWaiting.current = null;
      finish();
    });
    stopWaiting.current = unsubscribe;
    openTimelineImport("xml");
  }, [finish]);

  const openProject = useCallback(() => {
    if (busy) return;
    setError(null);
    setBusy(true);
    useOnboardingStore.getState().start("pro");
    openEditorProject()
      .then((opened) => {
        if (opened) finish();
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not open the project. Your current project is untouched.");
      })
      .finally(() => setBusy(false));
  }, [busy, finish]);

  const openCustomSequence = useCallback(() => {
    useOnboardingStore.getState().start("pro");
    useOnboardingStore.getState().showSheet("custom-sequence");
  }, []);

  return (
    <div role="group" aria-labelledby={labelId} className={className ?? "flex flex-col gap-4 rounded-xl border border-border bg-bg-2/60 p-4"}>
      <p id={labelId} className="text-sm font-semibold tracking-tight text-fg">
        Set it up your way.
      </p>

      <div className="flex flex-col gap-2">
        <span id={keysId} className="text-2xs font-semibold uppercase tracking-wider text-fg-3">
          Keys
        </span>
        <ToggleGroup
          type="single"
          value={keymap}
          onValueChange={pickKeymap}
          aria-labelledby={keysId}
          className="flex flex-wrap justify-start gap-1.5"
        >
          {KEYMAP_CHOICES.map((choice, index) => (
            <ToggleGroupItem
              key={choice.id}
              value={choice.id}
              ref={index === 0 ? firstChip : undefined}
              aria-label={`${choice.label} keys`}
              className={chipClass}
            >
              {choice.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {diff && (
          <div className="text-xs text-fg-3">
            <p aria-live="polite" data-testid="pro-keymap-caption">
              {describePresetDiff(diff)}
              {diff.count > 0 && (
                <>
                  {" "}
                  <button
                    type="button"
                    aria-expanded={showAll}
                    aria-controls={`${keysId}-all`}
                    onClick={() => setShowAll((open) => !open)}
                    className="rounded font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {showAll ? "Hide" : "See all"}
                  </button>
                </>
              )}
            </p>
            {showAll && diff.count > 0 && (
              <ul
                id={`${keysId}-all`}
                className="mt-2 max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-bg-1"
              >
                {diff.changes.map((change) => (
                  <li key={change.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate text-fg-2">
                      {change.name}
                      {change.displaced && <span className="text-fg-3"> (moved to make room)</span>}
                    </span>
                    <span className="shrink-0 text-fg-3">
                      <kbd className="text-2xs">{change.fromLabel}</kbd>
                      <span aria-hidden> → </span>
                      <span className="sr-only"> to </span>
                      <kbd className="text-2xs text-fg">{change.toLabel}</kbd>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span id={workspaceId} className="text-2xs font-semibold uppercase tracking-wider text-fg-3">
          Workspace
        </span>
        <ToggleGroup
          type="single"
          value={workspace}
          onValueChange={pickWorkspace}
          aria-labelledby={workspaceId}
          className="flex flex-wrap justify-start gap-1.5"
        >
          {ONBOARDING_WORKSPACES.map((w) => (
            <ToggleGroupItem key={w.id} value={w.id} aria-label={`${w.name} workspace`} className={chipClass}>
              {w.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={importTimeline} className={actionClass}>
          <FileUp size={14} aria-hidden />
          Import timeline (XML, AAF, FCPXML, OTIO)…
        </button>
        <button type="button" onClick={openProject} disabled={busy} className={actionClass}>
          <FolderOpen size={14} aria-hidden />
          Open project…
        </button>
        <button type="button" onClick={openCustomSequence} className={actionClass}>
          <SlidersHorizontal size={14} aria-hidden />
          Custom sequence…
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
