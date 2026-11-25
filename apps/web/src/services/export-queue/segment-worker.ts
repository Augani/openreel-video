import {
  createIsolatedExportEngine,
  setEncoderBackendFactory,
  type VideoExportSettings,
} from "@openreel/core";
import { loadEngineModules } from "../lazy-engines";
import { ensureProjectFonts } from "../project-fonts";
import { useProjectStore } from "../../stores/project-store";
import { NativeFFmpegBackend, SegmentAudioBackend } from "../native-ffmpeg-backend";
import { hydrateNativePaths } from "../native-path-hydration";
import { loadSnapshot } from "./export-queue-storage";
import type { SegmentWorkerRole } from "./segment-worker-protocol";

/**
 * A hidden worker window of a parallel export (desktop). It reads the queued job's project snapshot from the same
 * IndexedDB the editor wrote it to, then either renders segments of the picture (taking the next one from the main
 * process until none is left) or renders the audio of the whole timeline. The editor window is never involved in
 * rendering, so it stays free for editing.
 */
const NOOP_WRITABLE = {
  async seek() {},
  async write() {},
  async close() {},
  async abort() {},
  async truncate() {},
} as unknown as FileSystemWritableFileStream;

async function drive(generator: AsyncGenerator<{ progress: number }, { success: boolean; error?: { message?: string } }>): Promise<void> {
  for (;;) {
    const step = await generator.next();
    if (step.done) {
      if (!step.value.success) throw new Error(step.value.error?.message || "Export failed");
      return;
    }
  }
}

async function renderOnce(project: Parameters<ReturnType<typeof createIsolatedExportEngine>["engine"]["exportVideo"]>[0], settings: VideoExportSettings): Promise<void> {
  const isolated = createIsolatedExportEngine();
  try {
    await isolated.engine.initialize();
    await drive(isolated.engine.exportVideo(project, settings, NOOP_WRITABLE) as never);
  } finally {
    await isolated.dispose();
  }
}

export async function runSegmentWorker(sessionId: string, role: SegmentWorkerRole): Promise<void> {
  const bridge = window.openreel?.exportSegments;
  if (!bridge) throw new Error("Parallel export needs the desktop app.");
  try {
    const init = (await bridge.init(sessionId)) as { jobId: string; settings: VideoExportSettings };
    const project = await loadSnapshot(init.jobId);
    if (!project) throw new Error("The queued project could not be read back for the export workers.");
    await ensureProjectFonts(project);
    // A blob read back from storage has lost the file it came from; native decode (ProRes ...) needs that path again.
    hydrateNativePaths(project.mediaLibrary.items);
    // Effects, transitions and overlays render through engines that follow the project in this window's stores.
    useProjectStore.getState().syncRenderProcessingFrom(project);
    // Generated (AI) shaders are registered when the editor opens a project; a worker has to do the same or those effects render as nothing.
    const engines = await loadEngineModules();
    engines.registerProjectGeneratedShaders(project);
    const base: VideoExportSettings = { ...init.settings, smartRender: false };
    if (role === "audio") {
      setEncoderBackendFactory(() => new SegmentAudioBackend(sessionId));
      await renderOnce(project, { ...base, segmentWindow: { startFrame: 0, endFrame: 0, role: "audio" } });
    } else {
      for (let segment = await bridge.next(sessionId); segment; segment = await bridge.next(sessionId)) {
        const { index, startFrame, endFrame } = segment as { index: number; startFrame: number; endFrame: number };
        setEncoderBackendFactory(() => new NativeFFmpegBackend(() => "segment", { sessionId, index }));
        await renderOnce(project, { ...base, segmentWindow: { startFrame, endFrame, role: "video" } });
      }
    }
    window.close();
  } catch (error) {
    await bridge.fail(sessionId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
  }
}
