import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@openreel/ui";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderOpen,
  Layers,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "@/icons/lucide-compat";
import { exportQueueSummary, isStemsJob, planStemExport, type ExportJob, type ExportJobStatus } from "@openreel/core";
import { initExportQueue, useExportQueueStore } from "../../stores/export-queue-store";
import { useProjectStore } from "../../stores/project-store";

const isDesktop = (): boolean => typeof window !== "undefined" && window.openreel?.platform === "desktop";

export function formatClock(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "--:--";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const STATUS_LABEL: Record<ExportJobStatus, string> = {
  queued: "Queued",
  running: "Exporting",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const STATUS_TONE: Record<ExportJobStatus, string> = {
  queued: "bg-bg-3 text-fg-muted",
  running: "bg-accent/20 text-accent",
  completed: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-bg-3 text-fg-muted",
  interrupted: "bg-amber-500/15 text-amber-400",
};

function rangeLabel(job: ExportJob): string {
  if (isStemsJob(job)) return `${job.stems?.ids?.length ?? job.stems?.busIds?.length ?? 0} stems`;
  if (!job.range) return "Entire sequence";
  return `${formatClock(job.range.startTime * 1000)} - ${formatClock(job.range.endTime * 1000)}`;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 text-fg-2 hover:text-fg-1"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** "Smart render: 62% copied", plus why less was copied when a reason exists. */
export function smartRenderDetail(report: ExportJob["smartRender"]): string {
  if (!report) return "";
  const reason = report.copiedPercent < 100 ? report.reasons?.[0] : undefined;
  if (!reason) return report.summary;
  const more = (report.reasons?.length ?? 0) > 1 ? ` +${(report.reasons?.length ?? 1) - 1} more` : "";
  return `${report.summary} (${reason}${more})`;
}

function JobRow({ job, queuedIndex, queuedCount }: { job: ExportJob; queuedIndex: number; queuedCount: number }) {
  const store = useExportQueueStore.getState();
  const pct = Math.round(job.progress * 100);
  const detail =
    job.status === "running"
      ? `${pct}% · ${job.phase} · ETA ${formatClock(job.etaMs)} · ${formatClock(job.elapsedMs)} elapsed`
      : job.status === "completed"
        ? [
            formatBytes(job.output?.bytes ?? 0),
            `${formatClock(job.elapsedMs)} to export`,
            job.framesFromCache ? `${job.framesFromCache}/${job.totalFrames ?? "?"} frames from previews` : "",
            smartRenderDetail(job.smartRender),
            job.sourceMedia ?? "",
          ]
            .filter(Boolean)
            .join(" · ")
        : job.status === "queued"
          ? "Waiting"
          : (job.error ?? STATUS_LABEL[job.status]);
  return (
    <li
      data-testid="export-queue-job"
      data-status={job.status}
      data-job-id={job.id}
      className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg-1" title={job.outputName}>
          {job.outputName}
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[job.status])}>
          {STATUS_LABEL[job.status]}
        </span>
      </div>
      <div className="truncate text-[11px] text-fg-muted" title={`${job.sequenceName} · ${job.presetLabel} · ${rangeLabel(job)}`}>
        {job.sequenceName} · {job.presetLabel} · {rangeLabel(job)}
      </div>
      {(job.status === "running" || job.status === "completed") && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-bg-3"
          role="progressbar"
          aria-label={`${job.outputName} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
      {job.stemOutputs && job.stemOutputs.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded bg-bg-2 px-2 py-1" aria-label={`Stems in ${job.outputName}`} data-testid="export-queue-stems">
          {job.stemOutputs.map((stem) => (
            <li key={stem.filename} className="flex min-w-0 items-center gap-2 text-[11px] text-fg-muted" data-testid="export-queue-stem">
              <span className="min-w-0 flex-1 truncate text-fg-2" title={stem.filename}>
                {stem.filename}
              </span>
              <span className="shrink-0 font-mono">{formatBytes(stem.bytes)}</span>
              <span className="shrink-0 font-mono">{stem.durationSec.toFixed(1)}s</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1">
        <span
          className={cn("min-w-0 flex-1 truncate text-[11px]", job.error ? "text-red-400" : "text-fg-muted")}
          title={detail}
        >
          {detail}
        </span>
        {job.status === "queued" && (
          <>
            <IconButton label={`Move ${job.outputName} up`} disabled={queuedIndex === 0} onClick={() => store.move(job.id, queuedIndex - 1)}>
              <ArrowUp size={13} />
            </IconButton>
            <IconButton label={`Move ${job.outputName} down`} disabled={queuedIndex >= queuedCount - 1} onClick={() => store.move(job.id, queuedIndex + 1)}>
              <ArrowDown size={13} />
            </IconButton>
          </>
        )}
        {(job.status === "queued" || job.status === "running") && (
          <IconButton label={`Cancel ${job.outputName}`} onClick={() => store.cancel(job.id)}>
            <X size={13} />
          </IconButton>
        )}
        {(job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") && (
          <IconButton label={`Retry ${job.outputName}`} onClick={() => store.retry(job.id)}>
            <RotateCcw size={13} />
          </IconButton>
        )}
        {job.status === "completed" &&
          (isDesktop() && job.output?.path ? (
            <IconButton label={`Reveal ${job.outputName} in folder`} onClick={() => void store.reveal(job.id)}>
              <FolderOpen size={13} />
            </IconButton>
          ) : (
            <IconButton label={`Download ${job.outputName}`} onClick={() => void store.download(job.id)}>
              <Download size={13} />
            </IconButton>
          ))}
        {job.status !== "running" && (
          <IconButton label={`Remove ${job.outputName}`} onClick={() => store.remove(job.id)}>
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
    </li>
  );
}

/** Picks buses and bit depth, then queues one stems job (a zip of WAVs). */
const AddStemsButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const project = useProjectStore((s) => s.project);
  const plan = useMemo(() => (open ? planStemExport(project) : []), [open, project]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const chosen = plan.filter((item) => !excluded.has(item.busId));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[11px]" aria-label="Add stems to queue" data-testid="export-queue-add-stems">
          <Layers size={12} aria-hidden /> Stems
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[70] w-64 p-3" data-testid="export-queue-stems-form">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-fg-1">Export stems</span>
          {plan.length === 0 ? (
            <p className="text-[11px] text-fg-muted">
              No bus carries audio yet. Add a bus (the Dialogue / Music / FX preset in the Audio Mixer) and route tracks into it.
            </p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Buses to export">
              {plan.map((item) => (
                <li key={item.busId}>
                  <label className="flex items-center gap-2 text-[11px] text-fg-2">
                    <input
                      type="checkbox"
                      checked={!excluded.has(item.busId)}
                      onChange={(e) =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(item.busId);
                          else next.add(item.busId);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-fg-muted">{item.fileName.replace(/^.*_/, "")}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 text-[11px] text-fg-2">
            <span>Bit depth</span>
            {[16, 24].map((depth) => (
              <Button
                key={depth}
                type="button"
                size="sm"
                variant={bitDepth === depth ? "secondary" : "ghost"}
                className="h-5 px-1.5 text-[10px]"
                aria-pressed={bitDepth === depth}
                onClick={() => setBitDepth(depth as 16 | 24)}
              >
                {depth}-bit
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            disabled={chosen.length === 0}
            data-testid="export-queue-add-stems-confirm"
            onClick={() => {
              const job = useExportQueueStore.getState().enqueueStems({ busIds: chosen.map((item) => item.busId), bitDepth });
              if (job) setOpen(false);
            }}
          >
            Add {chosen.length} stem{chosen.length === 1 ? "" : "s"} to queue
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Non-modal queue window: stays open while the editor is used. */
export const ExportQueuePanel: React.FC = () => {
  const open = useExportQueueStore((s) => s.panelOpen);
  useEffect(() => {
    initExportQueue();
  }, []);
  // The job list changes on every progress tick; only subscribe to it while the panel is showing.
  return open ? <ExportQueuePanelBody /> : null;
};

const ExportQueuePanelBody: React.FC = () => {
  const queue = useExportQueueStore((s) => s.queue);
  const summary = exportQueueSummary(queue);
  const queuedIds = queue.jobs.filter((job) => job.status === "queued").map((job) => job.id);
  const store = useExportQueueStore.getState();
  const hasFinished = queue.jobs.some((job) => job.status === "completed" || job.status === "cancelled");
  const canStart = summary.queued > 0 && queue.paused;
  // Portalled out of the header: its stacking context would otherwise sit under the editor panes.
  return createPortal(
    <section
      role="region"
      aria-label="Export queue"
      data-testid="export-queue-panel"
      className="fixed bottom-3 right-3 z-[60] flex max-h-[60vh] w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-bg-1 shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ListVideo size={14} className="shrink-0 text-fg-2" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold leading-tight text-fg-1">Export queue</h2>
          <p className="truncate text-[11px] leading-tight text-fg-muted" data-testid="export-queue-summary">
            {summary.total === 0
              ? "Empty"
              : `${summary.running} running · ${summary.queued} queued · ${summary.completed} done${summary.failed ? ` · ${summary.failed} failed` : ""}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {queue.paused ? (
            <Button
              type="button"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              disabled={!canStart}
              onClick={() => store.start()}
              aria-label="Start queue"
            >
              <Play size={12} aria-hidden /> Start queue
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => store.pause()}
              aria-label="Pause queue"
            >
              <Pause size={12} aria-hidden /> Pause queue
            </Button>
          )}
          <AddStemsButton />
          <IconButton label="Clear finished jobs" disabled={!hasFinished} onClick={() => store.clearFinished()}>
            <Trash2 size={13} />
          </IconButton>
          <IconButton label="Close export queue" onClick={() => store.setPanelOpen(false)}>
            <X size={13} />
          </IconButton>
        </div>
      </header>
      {queue.jobs.length === 0 ? (
        <p className="px-3 py-6 text-center text-[11px] text-fg-muted">
          Use Add to queue in the Export dialog. Each job renders the project as it was when you added it.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Export jobs">
          {queue.jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              queuedIndex={queuedIds.indexOf(job.id)}
              queuedCount={queuedIds.length}
            />
          ))}
        </ul>
      )}
      {queue.paused && summary.queued > 0 && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-fg-muted">
          Queue is paused. A running export finishes before the queue stops.
        </p>
      )}
    </section>,
    document.body,
  );
};

/** Header button that opens the queue panel, with a live job count. */
export const ExportQueueButton: React.FC<{ className?: string }> = ({ className }) => {
  // Select the count, not the queue: progress ticks must not re-render the header.
  const active = useExportQueueStore(
    (s) => s.queue.jobs.filter((job) => job.status === "queued" || job.status === "running").length,
  );
  const open = useExportQueueStore((s) => s.panelOpen);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("relative", className)}
      aria-label="Export queue"
      aria-pressed={open}
      title="Export queue"
      onClick={() => useExportQueueStore.getState().setPanelOpen(!open)}
    >
      <ListVideo size={15} aria-hidden />
      {active > 0 && (
        <span
          data-testid="export-queue-badge"
          className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-accent px-1 text-[9px] font-semibold leading-[14px] text-white"
        >
          {active}
        </span>
      )}
    </Button>
  );
};
