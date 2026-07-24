import type { MediaItem } from "@openreel/core";
import { materializeToTemp, nativeMediaAvailable, getBridge } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useGpuJobStore } from "../stores/gpu-job-store";
import { submitClipJob, isDesktopGpuAvailable } from "./gpu-jobs";
import { loadMediaBlob } from "./media-storage";
import { outputForKind, applyModeForKind } from "../components/editor/ai-panel/ai-kinds.config";

const EMPTY_METADATA = {
  duration: 0,
  width: 0,
  height: 0,
  frameRate: 0,
  codec: "",
  sampleRate: 0,
  channels: 0,
  fileSize: 0,
} as const;

export function buildPlaceholder(mediaId: string, name: string, type: MediaItem["type"]): MediaItem {
  return {
    id: mediaId,
    name,
    type,
    fileHandle: null,
    blob: null,
    metadata: { ...EMPTY_METADATA },
    thumbnailUrl: null,
    waveformData: null,
    isPlaceholder: true,
    isPending: true,
  };
}

export interface SubmitSelectedClipJobArgs {
  kind: string;
  params?: Record<string, unknown>;
  suggestedName?: string;
  requiresClip?: boolean;
}

export async function submitSelectedClipJob(
  args: SubmitSelectedClipJobArgs,
): Promise<{ jobID: string; mediaId: string }> {
  const requiresClip = args.requiresClip ?? true;
  const project = useProjectStore.getState().project;
  if (!project) throw new Error("No project open");

  let srcPath: string | undefined;
  let blob: Blob | undefined;
  let filename: string | undefined;
  let contentType: string | undefined;
  let placeholderType: MediaItem["type"] = "video";
  let sourceClipId: string | undefined;
  let sourceMediaId: string | undefined;
  const newMediaId = `gpu-${args.kind}-${Date.now()}`;

  if (requiresClip) {
    const selectedClipIds = useUIStore.getState().getSelectedClipIds();
    if (selectedClipIds.length !== 1) throw new Error("Select a clip first");
    sourceClipId = selectedClipIds[0];
    const clip = useProjectStore.getState().getClip(selectedClipIds[0]);
    sourceMediaId = clip?.mediaId;
    if (!sourceMediaId) throw new Error("Select a clip first");

    const item = useProjectStore.getState().getMediaItem(sourceMediaId);
    if (item?.type) placeholderType = item.type;

    let loaded = item?.blob ?? null;
    if (!loaded) loaded = await loadMediaBlob(sourceMediaId);
    if (!loaded) throw new Error("Could not load clip media");

    filename = item?.name ?? "input";
    contentType = loaded.type || undefined;

    if (isDesktopGpuAvailable()) {
      if (!nativeMediaAvailable()) throw new Error("Native media bridge unavailable");
      const bridge = getBridge();
      if (!bridge) throw new Error("Native bridge unavailable");
      srcPath = await materializeToTemp(bridge, new File([loaded], filename, { type: contentType }));
    } else {
      blob = loaded;
    }
  }

  const suggestedName = args.suggestedName ?? `${args.kind} result`;
  const params: Record<string, unknown> = {
    context: { projectID: project.id, quality: "balanced" },
    ...(args.params ?? {}),
  };

  const { jobID } = await submitClipJob({ kind: args.kind, params, srcPath, blob, filename, contentType });

  const isMedia = outputForKind(args.kind) === "media";
  const replaceInPlace = isMedia && applyModeForKind(args.kind) === "replace" && !!sourceMediaId;
  const targetMediaId = replaceInPlace ? sourceMediaId! : newMediaId;

  // Only create a new library tile for genuinely-new-asset kinds (generated
  // music, audio stems, thumbnails). "replace" kinds overwrite the clip's own
  // source media in place — no new tile.
  if (isMedia && !replaceInPlace) {
    useProjectStore.getState().addPlaceholderMedia(buildPlaceholder(newMediaId, suggestedName, placeholderType));
  }
  useGpuJobStore.getState().addJob({
    jobID,
    mediaId: targetMediaId,
    projectId: project.id,
    kind: args.kind,
    suggestedName,
    sourceClipId,
  });
  return { jobID, mediaId: targetMediaId };
}
