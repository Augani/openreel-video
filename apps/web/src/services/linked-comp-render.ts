import {
  DEFAULT_VIDEO_SETTINGS,
  bakeSourceProject,
  getExportEngine,
  getGraphicInstance,
  getLinkedComposition,
  renderAndReplace,
  type ExportProgress,
  type ExportResult,
  type VideoExportSettings,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { createMemoryWritable } from "./memory-writable";
import { commitSequenceEdit } from "./sequence-commands";
import { ensureProjectFonts } from "./project-fonts";
import { selectGraphic } from "./graphic-selection";
import { selectedLinkedInstance, type LinkedCommandResult } from "./linked-comp-commands";

/**
 * Render and Replace: render the composition's layers (alone) to a media file with
 * the ordinary exporter, import the file, then swap the live layers for it in ONE
 * undoable edit. The import itself is not a history step (like any media import);
 * the swap is. Restore Unrendered is the reverse single step.
 */

const isDesktop = (): boolean => typeof window !== "undefined" && window.openreel?.platform === "desktop";

/** Desktop renders ProRes 4444 with alpha; the browser encoder has no alpha, so it renders an opaque H.264 file. */
export function bakeSettings(
  width: number,
  height: number,
  frameRate: number,
  range: { startTime: number; endTime: number },
): { settings: Partial<VideoExportSettings>; ext: "mov" | "mp4"; mime: string; alpha: boolean } {
  const base = { width, height, frameRate, range, smartRender: false } as const;
  if (isDesktop()) {
    return {
      settings: { ...base, format: "mov", codec: "prores", proresProfile: "4444", alpha: true, bitrate: 0, bitrateMode: "vbr", quality: 100, keyframeInterval: 1 },
      ext: "mov",
      mime: "video/quicktime",
      alpha: true,
    };
  }
  return {
    settings: { ...base, format: "mp4", codec: "h264", bitrate: 16000, bitrateMode: "vbr", quality: 95, keyframeInterval: 2 },
    ext: "mp4",
    mime: "video/mp4",
    alpha: false,
  };
}

async function renderToBlob(
  project: Parameters<ReturnType<typeof getExportEngine>["exportVideo"]>[0],
  settings: Partial<VideoExportSettings>,
  mime: string,
  onProgress: (progress: ExportProgress) => void,
): Promise<Blob> {
  const engine = getExportEngine();
  await engine.initialize();
  const sink = createMemoryWritable();
  const generator = engine.exportVideo(project, { ...DEFAULT_VIDEO_SETTINGS, ...settings }, sink.writable);
  let step = await generator.next();
  while (!step.done) {
    onProgress(step.value);
    step = await generator.next();
  }
  const result: ExportResult = step.value;
  if (!result.success) throw new Error(result.error?.message ?? "The render failed.");
  const blob = result.blob ?? sink.getBlob(mime);
  if (blob.size === 0) throw new Error("The render produced an empty file.");
  return blob;
}

export async function renderAndReplaceCommand(instanceId: string): Promise<LinkedCommandResult> {
  const fail = (message: string): LinkedCommandResult => {
    toast.warning("Render and Replace", message);
    return { ok: false, message };
  };
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project first.");
  if (useUIStore.getState().exportState.isExporting) return fail("Wait for the export to finish.");
  const project = store.getFullProject();
  const instance = getGraphicInstance(project, instanceId);
  if (!instance?.linkedCompositionId) return fail("Select a linked composition first.");
  if (instance.bake) return fail("That composition is already rendered. Restore Unrendered to edit it again.");
  const composition = getLinkedComposition(project, instance.linkedCompositionId);
  if (!composition) return fail("That composition no longer exists.");
  const source = bakeSourceProject(project, instanceId);
  if (!source.ok) return fail(source.message);

  const baked = bakeSettings(project.settings.width, project.settings.height, project.settings.frameRate, source.range);
  toast.info("Rendering composition", `"${instance.name}" is being rendered…`);
  let blob: Blob;
  try {
    await ensureProjectFonts(source.project);
    blob = await renderToBlob(source.project, baked.settings, baked.mime, () => undefined);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The render failed.");
  }

  const before = new Set(useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id));
  const fileName = `${instance.name} (rendered r${composition.revision}).${baked.ext}`;
  const file = new File([blob], fileName, { type: baked.mime, lastModified: Date.now() });
  const imported = await useProjectStore.getState().importMedia(file);
  if (!imported.success) return fail(imported.error?.message ?? "The rendered file could not be imported.");
  const media = useProjectStore.getState().project.mediaLibrary.items.find((item) => !before.has(item.id) && item.name === fileName);
  if (!media) return fail("The rendered file could not be found after importing it.");

  const result = await commitSequenceEdit("Render and replace", (current) => renderAndReplace(current, instanceId, media.id, {
    revision: composition.revision,
    startTime: instance.startTime,
    duration: instance.duration,
  }));
  if (!result.ok) return fail(result.message);
  selectGraphic(instanceId);
  toast.success(
    "Composition rendered",
    baked.alpha ? "Restore Unrendered brings the live layers back." : "Rendered without transparency in the browser. Restore Unrendered brings the live layers back.",
  );
  return { ok: true, project: result.project, instanceId };
}

/** "Render and Replace" for the selection. */
export async function renderSelectedLinkedComposition(): Promise<boolean> {
  const project = useProjectStore.getState().getFullProject();
  const instance = selectedLinkedInstance(project, useUIStore.getState().getSelectedClipIds());
  if (!instance) {
    toast.info("Render and Replace", "Select a linked composition on the timeline first.");
    return false;
  }
  return (await renderAndReplaceCommand(instance.id)).ok;
}
