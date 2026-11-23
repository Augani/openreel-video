import { useEffect, useMemo, useRef, useState } from "react";
import { Package } from "@/icons/lucide-compat";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Progress, ScrollArea } from "@openreel/ui";
import { DEFAULT_PROJECT_MANAGER_OPTIONS, PRESET_CHOICES } from "@openreel/core/project-manager/index";
import { ensureSequences } from "@openreel/core/timeline/sequences";
import { useProjectStore } from "../../../stores/project-store";
import { useProjectManagerStore } from "../../../stores/project-manager-store";
import { toast } from "../../../stores/notification-store";
import type { OpenReelProjectManagerEstimate, OpenReelProjectManagerOptions } from "../../../types/global";
import {
  cancelProjectManagerJob,
  openCollectedProject,
  projectJsonForManager,
  startProjectManagerJob,
} from "../../../services/project-consolidate";

const formatBytes = (bytes: number): string => {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.max(0, bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
};
const formatSeconds = (seconds: number): string => `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;

function Check({ id, checked, onChange, disabled, label, hint }: { id: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className={`flex items-start gap-2 text-xs ${disabled ? "opacity-50" : ""}`}>
      <input id={id} type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-primary" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="text-fg">{label}</span>
        {hint ? <span className="block text-[11px] leading-4 text-fg-3">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ProjectManagerDialog() {
  const open = useProjectManagerStore((s) => s.open);
  const setOpen = useProjectManagerStore((s) => s.setOpen);
  const job = useProjectManagerStore((s) => s.job);
  const projectName = useProjectStore((s) => s.project.name);
  const sequences = useMemo(() => {
    if (!open) return [];
    const project = ensureSequences(useProjectStore.getState().getFullProject());
    return (project.sequences ?? []).map((sequence) => ({ id: sequence.id, name: sequence.name, active: sequence.id === project.activeSequenceId }));
  }, [open]);

  const [options, setOptions] = useState<OpenReelProjectManagerOptions>({ ...DEFAULT_PROJECT_MANAGER_OPTIONS, sequenceIds: [] });
  const [destParent, setDestParent] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<OpenReelProjectManagerEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || sequences.length === 0) return;
    seeded.current = true;
    setOptions((current) => ({ ...current, sequenceIds: [(sequences.find((s) => s.active) ?? sequences[0]).id] }));
  }, [open, sequences]);

  const running = job !== null && (job.phase === "scanning" || job.phase === "running" || job.phase === "finalizing");
  const consolidate = options.mode === "consolidate";
  const set = <K extends keyof OpenReelProjectManagerOptions>(key: K, value: OpenReelProjectManagerOptions[K]): void => setOptions((current) => ({ ...current, [key]: value }));

  // The size estimate follows the options (debounced): it reads the media, so it is not free.
  useEffect(() => {
    if (!open || running || options.sequenceIds.length === 0) return;
    const bridge = window.openreel?.projectManager;
    if (!bridge) return;
    let stale = false;
    setEstimating(true);
    const timer = window.setTimeout(() => {
      const project = useProjectStore.getState().getFullProject();
      bridge
        .estimate({ projectJson: projectJsonForManager(project), options, destParent })
        .then((result) => {
          if (stale) return;
          setEstimate(result);
          setEstimateError(null);
        })
        .catch((error: unknown) => {
          if (!stale) setEstimateError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!stale) setEstimating(false);
        });
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [open, running, options, destParent]);

  const chooseFolder = async (): Promise<void> => {
    const folder = await window.openreel?.ingest?.pickFolder({ title: "Choose where the new project folder goes" });
    if (folder) setDestParent(folder);
  };

  const notEnoughRoom = estimate !== null && estimate.freeBytes !== null && estimate.freeBytes < estimate.totalBytes * 1.25;
  const canStart = !running && options.sequenceIds.length > 0 && destParent !== null && estimate !== null && !estimating && !notEnoughRoom;

  const start = async (): Promise<void> => {
    if (!destParent) return;
    try {
      await startProjectManagerJob(options, destParent, projectName);
    } catch (error) {
      toast.error("Could not start", error instanceof Error ? error.message : String(error));
    }
  };

  const finished = job && (job.phase === "done" || job.phase === "error" || job.phase === "cancelled");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="project-manager-dialog" className="flex h-[min(720px,calc(100dvh-32px))] w-[calc(100vw-24px)] max-w-[680px] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg-1 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Package size={18} className="text-primary" aria-hidden />
            Project Manager
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-fg-2">
            Copy the chosen sequences and their media into a new, self-contained project folder. Your original media and project are never changed.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-5 py-4">
            <section aria-label="Sequences">
              <h3 className="mb-2 text-xs font-semibold text-fg">Sequences</h3>
              <ul className="space-y-1.5">
                {sequences.map((sequence) => (
                  <li key={sequence.id}>
                    <Check
                      id={`pm-seq-${sequence.id}`}
                      checked={options.sequenceIds.includes(sequence.id)}
                      disabled={running}
                      onChange={(on) => set("sequenceIds", on ? [...options.sequenceIds, sequence.id] : options.sequenceIds.filter((id) => id !== sequence.id))}
                      label={sequence.name}
                      hint={sequence.active ? "Open now" : undefined}
                    />
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-fg-3">Sequences nested in a chosen sequence come along.</p>
            </section>

            <section aria-label="Action" className="space-y-2">
              <h3 className="text-xs font-semibold text-fg">Resulting project</h3>
              <label className="flex items-start gap-2 text-xs">
                <input type="radio" name="pm-mode" className="mt-0.5 accent-primary" checked={!consolidate} disabled={running} onChange={() => set("mode", "collect")} />
                <span><span className="text-fg">Collect Files and Copy to New Location</span><span className="block text-[11px] text-fg-3">Copies each file as it is.</span></span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input type="radio" name="pm-mode" className="mt-0.5 accent-primary" checked={consolidate} disabled={running} onChange={() => set("mode", "consolidate")} />
                <span><span className="text-fg">Consolidate and Transcode</span><span className="block text-[11px] text-fg-3">Converts the media to one format, optionally keeping only the parts you use.</span></span>
              </label>
              {consolidate ? (
                <div className="ml-6 space-y-2 rounded-md border border-border bg-bg-2 p-3">
                  <label className="flex items-center gap-2 text-xs text-fg">
                    Format
                    <select aria-label="Transcode preset" className="rounded border border-border bg-bg-1 px-2 py-1 text-xs" value={options.preset} disabled={running} onChange={(event) => set("preset", event.target.value as OpenReelProjectManagerOptions["preset"])}>
                      {PRESET_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                    </select>
                  </label>
                  <Check id="pm-trim" checked={options.trim} disabled={running} onChange={(on) => set("trim", on)} label="Trim media to the parts used, plus handles" hint="Each file keeps only what the sequences play; clip in and out points are rewritten so every frame stays the same." />
                  {options.trim ? (
                    <label className="ml-6 flex items-center gap-2 text-xs text-fg">
                      Handles
                      <input aria-label="Handle frames" type="number" min={0} max={1000} className="w-20 rounded border border-border bg-bg-1 px-2 py-1 text-xs" value={options.handleFrames} disabled={running} onChange={(event) => set("handleFrames", Math.max(0, Math.min(1000, Math.round(Number(event.target.value) || 0))))} />
                      frames each side
                    </label>
                  ) : null}
                  <Check id="pm-conform" checked={options.includeAudioConform} disabled={running} onChange={(on) => set("includeAudioConform", on)} label="Conform audio to 48 kHz PCM" hint="Writes the sound of every transcoded file as 24-bit 48 kHz PCM (the project's working format)." />
                </div>
              ) : null}
            </section>

            <section aria-label="Options" className="space-y-2">
              <h3 className="text-xs font-semibold text-fg">Options</h3>
              <Check id="pm-unused" checked={options.excludeUnused} disabled={running} onChange={(on) => set("excludeUnused", on)} label="Exclude unused clips" hint="Leave out media the chosen sequences never play." />
              <Check id="pm-proxies" checked={options.includeProxies} disabled={running} onChange={(on) => set("includeProxies", on)} label="Include proxies" hint="Proxies are cut with their media when it is trimmed." />
              <Check id="pm-render" checked={options.includeRenderFiles} disabled={running || (consolidate && options.trim)} onChange={(on) => set("includeRenderFiles", on)} label="Include preview (render) files" hint={consolidate && options.trim ? "Not available when trimming: trimming moves every frame." : "Copied with the project and restored when it is opened."} />
              <Check id="pm-rename" checked={options.renameToClipNames} disabled={running} onChange={(on) => set("renameToClipNames", on)} label="Rename media to clip names" hint="Files are named after the media in the Project panel." />
              <Check id="pm-seq" checked disabled onChange={() => undefined} label="Convert image sequences to clips" hint="Always on: OpenReel turns an image sequence into a video clip when it is imported, so a project never holds one." />
            </section>

            <section aria-label="Destination" className="space-y-2">
              <h3 className="text-xs font-semibold text-fg">Destination</h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={running} onClick={() => void chooseFolder()}>Browse…</Button>
                <span data-testid="pm-destination" className="min-w-0 truncate text-xs text-fg-2">{destParent ?? "Choose a folder; the project gets a folder of its own inside it."}</span>
              </div>
            </section>

            <section aria-label="Disk space estimate" data-testid="pm-estimate" className="rounded-md border border-border bg-bg-2 p-3 text-xs">
              <h3 className="mb-1 font-semibold text-fg">Disk space</h3>
              {estimateError ? <p role="alert" className="text-red-400">{estimateError}</p> : estimate ? (
                <>
                  <p className="text-fg">
                    <span data-testid="pm-estimate-total">{formatBytes(estimate.totalBytes)}</span> needed
                    {estimate.freeBytes !== null ? <span className="text-fg-2"> · {formatBytes(estimate.freeBytes)} free</span> : null}
                    {estimating ? <span className="text-fg-3"> · updating…</span> : null}
                  </p>
                  <p className="text-[11px] text-fg-3">
                    Media {formatBytes(estimate.mediaBytes)}{estimate.proxyBytes ? ` · proxies ${formatBytes(estimate.proxyBytes)}` : ""}{estimate.renderBytes ? ` · render files ${formatBytes(estimate.renderBytes)}` : ""}
                    {estimate.droppedCount ? ` · ${estimate.droppedCount} unused left out` : ""}
                  </p>
                  {notEnoughRoom ? <p role="alert" className="mt-1 text-red-400">Not enough free space at the destination.</p> : null}
                  {estimate.warnings.map((warning) => <p key={warning} className="mt-1 text-[11px] text-amber-400">{warning}</p>)}
                  <ul className="mt-2 max-h-32 space-y-0.5 overflow-auto text-[11px] text-fg-2">
                    {estimate.items.map((item) => (
                      <li key={item.mediaId} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{item.name}</span>
                        <span className="shrink-0">{item.action === "offline" ? item.note ?? "offline" : `${item.action === "copy" ? "copy" : "transcode"}${item.trimmed ? ` ${formatSeconds(item.keptSeconds)} of ${formatSeconds(item.sourceSeconds)}` : ""} · ${formatBytes(item.bytes)}`}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="text-fg-3">{estimating ? "Reading the media…" : "Choose a sequence to see the size."}</p>}
            </section>
          </div>
        </ScrollArea>
        <div className="shrink-0 border-t border-border px-5 py-3" data-testid="pm-footer">
          {job ? (
            <div className="mb-3 space-y-1.5" data-testid="pm-progress" data-phase={job.phase}>
              <Progress value={Math.round(job.fraction * 100)} aria-label="Project Manager progress" />
              <p className="text-[11px] text-fg-2">
                {job.phase === "error" ? `Failed: ${job.error}` : job.phase === "cancelled" ? "Cancelled. Nothing was kept." : job.phase === "done" ? `Done: ${job.summary?.files ?? 0} files, ${formatBytes(job.summary?.bytes ?? 0)}` : `${job.label}${job.itemCount ? ` (${job.itemIndex} of ${job.itemCount})` : ""}`}
              </p>
              {job.phase === "done" && job.summary?.warnings.length ? job.summary.warnings.map((w) => <p key={w} className="text-[11px] text-amber-400">{w}</p>) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {running ? <Button size="sm" variant="secondary" onClick={() => void cancelProjectManagerJob()}>Cancel</Button> : null}
            {job?.phase === "done" && job.projectPath ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => void window.openreel?.fs.revealInFolder(job.projectPath as string)}>Show in folder</Button>
                <Button size="sm" onClick={() => { void openCollectedProject(job.projectPath as string).then(() => setOpen(false)).catch((error: unknown) => toast.error("Could not open the project", error instanceof Error ? error.message : String(error))); }}>Open new project</Button>
              </>
            ) : null}
            {!running ? <Button size="sm" disabled={!canStart} onClick={() => void start()}>{finished ? "Run again" : consolidate ? "Consolidate" : "Collect"}</Button> : null}
            {!running ? <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Close</Button> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
