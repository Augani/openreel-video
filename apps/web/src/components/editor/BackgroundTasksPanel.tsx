import React, { useEffect, useSyncExternalStore } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import { Activity, AlertTriangle, Check, RotateCcw, Trash2, X } from "@/icons/lucide-compat";
import {
  backgroundTasks,
  formatTaskEta,
  isActiveStatus,
  summarizeTasks,
  type BackgroundTaskKind,
  type BackgroundTaskView,
} from "@openreel/core/tasks/task-registry";
import { startBackgroundTaskSources } from "../../services/background-task-sources";

const KIND_LABEL: Record<BackgroundTaskKind, string> = {
  export: "Export",
  proxy: "Proxy",
  transcription: "Transcription",
  import: "Import",
  analysis: "Analysis",
  tracking: "Tracking",
  other: "Task",
};

const useTasks = (): readonly BackgroundTaskView[] =>
  useSyncExternalStore(backgroundTasks.subscribe, backgroundTasks.getSnapshot, backgroundTasks.getSnapshot);

function TaskRow({ task }: { task: BackgroundTaskView }) {
  const active = isActiveStatus(task.status);
  const percent = task.progress === null ? null : Math.round(task.progress * 100);
  const eta = task.status === "running" ? formatTaskEta(task.etaMs) : "";
  return (
    <li className="border-b border-border px-3 py-2 last:border-b-0" data-testid="background-task-row" data-task-id={task.id} data-status={task.status}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-bg-3 px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{KIND_LABEL[task.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-1" title={task.title}>{task.title}</span>
        {task.status === "completed" && <Check size={13} className="shrink-0 text-status-success" aria-label="Completed" />}
        {task.status === "failed" && <AlertTriangle size={13} className="shrink-0 text-status-error" aria-label="Failed" />}
        {task.can.cancel && (
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={`Cancel ${task.title}`} onClick={() => backgroundTasks.cancel(task.id)}>
            <X size={13} />
          </Button>
        )}
        {task.can.pause && <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => backgroundTasks.pause(task.id)}>Pause</Button>}
        {task.can.resume && <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => backgroundTasks.resume(task.id)}>Resume</Button>}
        {task.can.retry && (
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" aria-label={`Retry ${task.title}`} onClick={() => backgroundTasks.retry(task.id)}>
            <RotateCcw size={11} aria-hidden /> Retry
          </Button>
        )}
      </div>
      {active && (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-bg-3 ring-1 ring-inset ring-border"
          role="progressbar"
          aria-label={`${task.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={cn("h-full rounded-full bg-accent-strong transition-[width]", percent === null && task.status === "running" && "w-1/3 animate-pulse")}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      <p className="mt-1 truncate text-xs text-fg-muted">
        {task.status === "failed"
          ? task.error ?? "Failed"
          : task.status === "queued"
            ? "Waiting"
            : task.status === "paused"
              ? task.detail ?? "Paused"
              : task.status === "cancelled"
                ? "Cancelled"
                : task.status === "completed"
                  ? "Done"
                  : [percent === null ? "Working…" : `${percent}%`, eta && `${eta} left`, task.detail].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

/** Status-bar indicator and popover listing every background job (exports, proxies, transcription, imports, analysis, tracking). */
export const BackgroundTasksIndicator: React.FC<{ className?: string }> = ({ className }) => {
  useEffect(() => startBackgroundTaskSources(), []);
  const tasks = useTasks();
  const summary = summarizeTasks(tasks);
  const hasFinished = tasks.some((t) => !isActiveStatus(t.status));
  const busy = summary.active > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("relative flex h-full items-center gap-1.5 rounded px-2 text-xs font-medium text-fg-1 transition-colors hover:bg-bg-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent", className)}
          aria-label={`Background tasks: ${summary.label}`}
          data-testid="background-tasks-button"
          data-active={summary.active}
        >
          <Activity size={14} aria-hidden className={cn(busy && "text-accent")} />
          <span className="truncate" data-testid="background-tasks-badge" data-count={summary.active}>
            {busy || summary.failed > 0 ? summary.label : "Idle"}
          </span>
          {summary.failed > 0 && busy && <span className="h-1.5 w-1.5 rounded-full bg-status-error" aria-hidden />}
          {summary.progress !== null && (
            <span className="h-2 w-20 overflow-hidden rounded-full bg-bg-3 ring-1 ring-inset ring-border" aria-hidden>
              <span className="block h-full rounded-full bg-accent-strong" style={{ width: `${Math.round(summary.progress * 100)}%` }} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[400px] max-w-[calc(100vw-24px)] p-0 data-[state=open]:animate-none data-[state=closed]:animate-none" data-testid="background-tasks-panel">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold leading-tight text-fg-1">Background tasks</h2>
            <p className="truncate text-xs leading-tight text-fg-muted" data-testid="background-tasks-summary">{summary.label}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Clear finished tasks" disabled={!hasFinished} onClick={() => backgroundTasks.clearFinished()}>
            <Trash2 size={13} />
          </Button>
        </header>
        {tasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-muted">Exports, proxies, transcription, imports and analysis show up here while they run.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto" aria-label="Background tasks">
            {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
          </ul>
        )}
        <p className="border-t border-border px-3 py-2 text-xs text-fg-muted" data-testid="background-tasks-note">
          Cancel works on every running task. Pause is only available for export-queue jobs, and pauses the whole queue; running exports, proxies and analysis cannot be paused.
        </p>
      </PopoverContent>
    </Popover>
  );
};
