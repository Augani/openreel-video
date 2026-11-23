import { BrowserWindow } from "electron";
import { CHANNELS } from "../../shared/channels";
import {
  type ProjectManagerEstimateResult,
  projectManagerCancelArgsSchema,
  projectManagerEstimateArgsSchema,
  projectManagerStartArgsSchema,
} from "../../shared/project-manager";
import { handle } from "../ipc";
import { renderCacheRoot } from "../render-cache/ipc";
import { freeBytesFor, renderCacheDirInfo, parseProject, scanProject, startProjectManagerJob, type ProjectManagerEvent, type ProjectManagerJob } from "./runner";
import { estimateItemBytes } from "../../../../../packages/core/src/project-manager";
import path from "node:path";

const jobs = new Map<string, ProjectManagerJob>();

function broadcast(event: ProjectManagerEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.projectManagerEvent, event);
  }
}

/** Quit: stop ffmpeg and remove the half-written folders. */
export function cancelProjectManagerJobs(): void {
  for (const job of jobs.values()) job.cancel();
}

export function registerProjectManagerIpc(): void {
  handle(CHANNELS.projectManagerEstimate, projectManagerEstimateArgsSchema, async (args): Promise<ProjectManagerEstimateResult> => {
    const project = parseProject(args.projectJson);
    const cache = args.options.includeRenderFiles ? await renderCacheDirInfo(renderCacheRoot(), project.id) : null;
    const scan = await scanProject(project, args.options, cache?.bytes ?? 0);
    const byId = new Map(scan.estimate.perItem.map((p) => [p.mediaId, p.bytes]));
    return {
      totalBytes: scan.estimate.totalBytes,
      mediaBytes: scan.estimate.mediaBytes,
      proxyBytes: scan.estimate.proxyBytes,
      renderBytes: scan.estimate.renderBytes,
      freeBytes: args.destParent ? await freeBytesFor(args.destParent) : null,
      items: scan.plan.items.map((item) => ({
        mediaId: item.mediaId,
        name: item.name,
        action: item.action,
        trimmed: item.segments !== null,
        keptSeconds: item.keptSeconds,
        sourceSeconds: item.sourceDuration,
        bytes: byId.get(item.mediaId) ?? estimateItemBytes(item),
        ...(item.note ? { note: item.note } : {}),
      })),
      droppedCount: scan.plan.droppedMediaIds.length,
      warnings: scan.plan.warnings,
    };
  });

  handle(CHANNELS.projectManagerStart, projectManagerStartArgsSchema, (args) => {
    const project = parseProject(args.projectJson);
    const job = startProjectManagerJob(
      { project, options: args.options, destParent: path.resolve(args.destParent), projectName: args.projectName },
      broadcast,
      { renderCacheRoot: renderCacheRoot() },
    );
    jobs.set(job.jobId, job);
    void job.done.then(() => undefined, () => undefined).finally(() => jobs.delete(job.jobId));
    return { jobId: job.jobId };
  });

  handle(CHANNELS.projectManagerCancel, projectManagerCancelArgsSchema, ({ jobId }) => {
    jobs.get(jobId)?.cancel();
    return true;
  });
}
