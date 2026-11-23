import React, { Suspense, lazy, useEffect, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import { Activity } from "@/icons/lucide-compat";
import { backgroundTasks, summarizeTasks } from "@openreel/core/tasks/task-registry";
import { startBackgroundTaskSources } from "../../services/background-task-sources";

// The list, rows and controls load the first time the popover opens; the status-bar indicator stays tiny.
const BackgroundTasksList = lazy(() => import("./BackgroundTasksList"));

const useTasks = () => useSyncExternalStore(backgroundTasks.subscribe, backgroundTasks.getSnapshot, backgroundTasks.getSnapshot);

/** Status-bar indicator and popover listing every background job (exports, proxies, transcription, imports, analysis, tracking). */
export const BackgroundTasksIndicator: React.FC<{ className?: string }> = ({ className }) => {
  useEffect(() => startBackgroundTaskSources(), []);
  const tasks = useTasks();
  const summary = summarizeTasks(tasks);
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
        <Suspense fallback={<p className="px-3 py-6 text-center text-xs text-fg-muted" role="status">Loading tasks…</p>}>
          <BackgroundTasksList />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
};
