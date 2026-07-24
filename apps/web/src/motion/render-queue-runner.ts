import type { ExportProgress, MotionComposition } from "@openreel/core";
import type { Project } from "@openreel/core/types/project";
import { exportMotionCompositionScene } from "./export-motion-frame";
import {
  useMotionStore,
  type MotionRenderQueueItem,
} from "./stores/motion-store";

export interface RenderQueueRunOutcome {
  readonly itemId: string;
  readonly status: MotionRenderQueueItem["status"];
  readonly encodedFormat?: MotionRenderQueueItem["format"];
  readonly filename?: string;
  readonly error?: string;
}

export interface RenderQueueRunResult {
  readonly outcomes: RenderQueueRunOutcome[];
  readonly alreadyRunning: boolean;
}

export interface RunRenderQueueDeps {
  readonly project: Project;
  readonly compositions: readonly MotionComposition[];
}

let queueRunning = false;

export function isRenderQueueRunning(): boolean {
  return queueRunning;
}

export function isRunnableRenderQueueItem(item: MotionRenderQueueItem): boolean {
  return item.status === "queued" || item.status === "failed";
}

function isItemCancelRequested(itemId: string): boolean {
  return (
    useMotionStore
      .getState()
      .renderQueue.find((entry) => entry.id === itemId)?.cancelRequested === true
  );
}

export async function runMotionRenderQueue(
  deps: RunRenderQueueDeps,
): Promise<RenderQueueRunResult> {
  if (queueRunning) {
    return { outcomes: [], alreadyRunning: true };
  }
  queueRunning = true;
  useMotionStore.getState().setExportActive(true);
  try {
    return await runQueueItems(deps);
  } finally {
    queueRunning = false;
    useMotionStore.getState().setExportActive(false);
  }
}

async function runQueueItems(
  deps: RunRenderQueueDeps,
): Promise<RenderQueueRunResult> {
  const { project, compositions } = deps;
  const store = useMotionStore.getState();
  const updateRenderQueueItem = store.updateRenderQueueItem;
  const items = useMotionStore
    .getState()
    .renderQueue.filter(isRunnableRenderQueueItem);
  const outcomes: RenderQueueRunOutcome[] = [];

  for (const item of items) {
    const scene = compositions.find(
      (candidate) => candidate.id === item.compositionId,
    );
    if (!scene) {
      const error = "Scene no longer exists.";
      updateRenderQueueItem(item.id, {
        status: "failed",
        error,
        completedAt: Date.now(),
      });
      outcomes.push({ itemId: item.id, status: "failed", error });
      continue;
    }

    if (isItemCancelRequested(item.id)) {
      updateRenderQueueItem(item.id, {
        status: "canceled",
        completedAt: Date.now(),
      });
      outcomes.push({ itemId: item.id, status: "canceled" });
      continue;
    }

    updateRenderQueueItem(item.id, {
      status: "rendering",
      progress: 0,
      error: undefined,
    });

    try {
      const result = await exportMotionCompositionScene({
        project,
        composition: scene,
        compositionLibrary: compositions.length > 0 ? compositions : [scene],
        format: item.format,
        ...(item.range !== undefined ? { range: item.range } : {}),
        ...(item.resolutionScale !== undefined
          ? { resolutionScale: item.resolutionScale }
          : {}),
        isCanceled: () => isItemCancelRequested(item.id),
        onProgress: (progress: ExportProgress) => {
          updateRenderQueueItem(item.id, {
            progress: Math.round(progress.progress * 100),
          });
        },
      });
      if (result.canceled === true) {
        updateRenderQueueItem(item.id, {
          status: "canceled",
          completedAt: Date.now(),
        });
        outcomes.push({ itemId: item.id, status: "canceled" });
        continue;
      }
      const encodedFormat = result.encodedFormat ?? item.format;
      updateRenderQueueItem(item.id, {
        status: "complete",
        progress: 100,
        outputFilename: result.filename,
        completedAt: Date.now(),
      });
      outcomes.push({
        itemId: item.id,
        status: "complete",
        encodedFormat,
        filename: result.filename,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Render job failed.";
      updateRenderQueueItem(item.id, {
        status: "failed",
        error: message,
        completedAt: Date.now(),
      });
      outcomes.push({ itemId: item.id, status: "failed", error: message });
    }
  }

  return { outcomes, alreadyRunning: false };
}
