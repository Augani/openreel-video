import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { saveMediaBlob } from "./media-storage";
import { buildPlaceholder } from "./gpu-clip-submit";
import type { PendingGpuJob } from "../stores/gpu-job-store";

function mediaKindFromMime(mime: string): MediaItem["type"] | null {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  no_vocals: "Instrumental",
};

function stemLabelFromPath(relativePath: string): string {
  const base = relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "stem";
  return STEM_LABELS[base] ?? base.charAt(0).toUpperCase() + base.slice(1);
}

export async function importGpuResult(args: {
  job: PendingGpuJob;
  bytes: ArrayBuffer;
  mime: string;
  relativePath: string;
}): Promise<void> {
  const name =
    args.job.suggestedName || args.relativePath.split("/").pop() || "AI Result";
  const file = new File([args.bytes], name, { type: args.mime });

  const store = useProjectStore.getState();
  const target = store.getMediaItem(args.job.mediaId);

  // Guard: a "replace" kind targets the clip's own source media. If the result
  // is a different media type than that clip (e.g. a stale worker returned bare
  // audio for a video clip), replacing in place would break the clip — import
  // the result as a new library item instead.
  const resultKind = mediaKindFromMime(args.mime);
  const mismatch =
    target != null &&
    !target.isPlaceholder &&
    resultKind != null &&
    target.type !== resultKind;

  let targetId = args.job.mediaId;
  if (mismatch) {
    targetId = `gpu-result-${args.job.kind}-${Date.now()}`;
    store.addPlaceholderMedia(buildPlaceholder(targetId, name, resultKind ?? "video"));
  }

  const result = await store.replaceMediaAsset(targetId, file);
  if (!result.success) {
    throw new Error(result.error?.message ?? "Failed to import GPU result");
  }

  // The blob was swapped under a stable media id, so decode caches keyed by that
  // id are stale — invalidate them so the timeline re-decodes the new media.
  if (!mismatch) {
    const videoEngine = useEngineStore.getState().videoEngine;
    videoEngine?.invalidateMedia(targetId);
    videoEngine?.clearCache();
  }

  const item = store.getMediaItem(targetId);
  if (item) {
    const projectId = store.project?.id;
    if (projectId) {
      await saveMediaBlob(projectId, targetId, file, item.metadata);
    }
  }
}

/**
 * Import multiple result artifacts (e.g. demucs stems) as separate, labeled
 * audio library items. The first artifact reuses the job's placeholder tile;
 * the rest get fresh ids. Without this, audio_separation imported only the
 * primaryArtifact (alphabetically-first = bass), which is often silent.
 */
export async function importGpuStems(args: {
  job: PendingGpuJob;
  stems: Array<{ bytes: ArrayBuffer; mime: string; relativePath: string }>;
}): Promise<void> {
  if (args.stems.length === 0) throw new Error("No stems to import");

  const store = useProjectStore.getState();
  const projectId = store.project?.id;
  const base = (args.job.suggestedName ?? "Audio").replace(/\s*result$/i, "").trim() || "Audio";

  for (let index = 0; index < args.stems.length; index += 1) {
    const stem = args.stems[index];
    const label = stemLabelFromPath(stem.relativePath);
    const fileName = `${base} — ${label}.wav`;
    const file = new File([stem.bytes], fileName, { type: stem.mime || "audio/wav" });

    const targetId =
      index === 0 ? args.job.mediaId : `${args.job.mediaId}-${label.toLowerCase()}`;
    if (index > 0) {
      store.addPlaceholderMedia(buildPlaceholder(targetId, fileName, "audio"));
    }

    const result = await store.replaceMediaAsset(targetId, file);
    if (!result.success) {
      throw new Error(result.error?.message ?? `Failed to import ${label} stem`);
    }

    const item = store.getMediaItem(targetId);
    if (item && projectId) {
      await saveMediaBlob(projectId, targetId, file, item.metadata);
    }
  }
}
