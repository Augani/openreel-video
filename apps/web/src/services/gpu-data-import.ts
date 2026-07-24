import type { Subtitle, Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { DEFAULT_SUBTITLE_STYLE } from "../stores/project/subtitle-helpers";
import { toast } from "../stores/notification-store";
import { applyHighlightRanges } from "./highlight-apply";
import { getMotionTrackingBridge } from "../bridges/motion-tracking-bridge";
import type { PendingGpuJob } from "../stores/gpu-job-store";
import type { AiKindOutput } from "../components/editor/ai-panel/ai-kinds.config";

export interface RawManifest {
  subtitles?: unknown;
  trackingPaths?: unknown;
  highlights?: unknown;
  metadata?: Record<string, unknown>;
}

interface ClipWindow {
  clipStart: number;
  inPoint: number;
  outPoint: number;
}

function clipWindow(sourceClipId?: string): ClipWindow {
  const clip: Clip | undefined = sourceClipId
    ? useProjectStore.getState().getClip(sourceClipId)
    : undefined;
  return {
    clipStart: clip?.startTime ?? 0,
    inPoint: clip?.inPoint ?? 0,
    outPoint: clip?.outPoint ?? Number.POSITIVE_INFINITY,
  };
}

function toTimeline(mediaTime: number, w: ClipWindow): number | null {
  if (mediaTime < w.inPoint - 0.001 || mediaTime > w.outPoint + 0.001) return null;
  const clamped = Math.max(w.inPoint, Math.min(w.outPoint, mediaTime));
  return w.clipStart + (clamped - w.inPoint);
}

async function applySubtitles(raw: RawManifest, job: PendingGpuJob): Promise<number> {
  const subs = Array.isArray(raw.subtitles) ? raw.subtitles : [];
  const store = useProjectStore.getState();
  const w = clipWindow(job.sourceClipId);
  let count = 0;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i] as Record<string, unknown>;
    const text = typeof s.text === "string" ? s.text.trim() : "";
    const startTime = typeof s.startTime === "number" ? s.startTime : null;
    const endTime = typeof s.endTime === "number" ? s.endTime : null;
    if (!text || startTime === null || endTime === null) continue;
    const tlStart = toTimeline(startTime, w);
    if (tlStart === null) continue;
    const tlEnd = toTimeline(Math.max(endTime, startTime + 0.3), w) ?? tlStart + 0.3;
    const subtitle: Subtitle = {
      id: typeof s.id === "string" ? s.id : `gpu-sub-${Date.now()}-${i}`,
      text,
      startTime: tlStart,
      endTime: Math.max(tlStart + 0.3, tlEnd),
      style: { ...DEFAULT_SUBTITLE_STYLE },
    };
    await store.addSubtitle(subtitle);
    count++;
  }
  return count;
}

function applyScenes(raw: RawManifest, job: PendingGpuJob): number {
  const scenes = Array.isArray(raw.metadata?.scenes)
    ? (raw.metadata?.scenes as unknown[])
    : [];
  const store = useProjectStore.getState();
  const w = clipWindow(job.sourceClipId);
  let count = 0;
  for (const entry of scenes) {
    const sc = entry as Record<string, unknown>;
    const mediaTime = typeof sc.startTime === "number" ? sc.startTime : null;
    if (mediaTime === null) continue;
    const tl = toTimeline(mediaTime, w);
    if (tl === null || tl <= w.clipStart + 0.05) continue;
    count += 1;
    void store.addMarker(tl, `Scene ${count + 1}`, "#22d3ee");
  }
  return count;
}

async function applyHighlights(raw: RawManifest, job: PendingGpuJob): Promise<number> {
  if (!job.sourceClipId) return 0;
  const hs = Array.isArray(raw.highlights) ? raw.highlights : [];
  const ranges = hs
    .map((entry) => {
      const h = entry as Record<string, unknown>;
      return { start: Number(h.start), end: Number(h.end) };
    })
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  if (ranges.length === 0) return 0;
  return applyHighlightRanges(job.sourceClipId, ranges);
}

function applyTracking(raw: RawManifest, job: PendingGpuJob): number {
  if (!job.sourceClipId) return 0;
  const paths = Array.isArray(raw.trackingPaths) ? raw.trackingPaths : [];
  const path = paths[0] as Record<string, unknown> | undefined;
  const kfs = Array.isArray(path?.keyframes) ? (path?.keyframes as unknown[]) : [];
  const keyframes = kfs
    .map((entry) => {
      const k = entry as Record<string, unknown>;
      const bb = k.boundingBox as Record<string, number> | undefined;
      if (!bb) return null;
      return {
        frame: Number(k.frameIndex ?? 0),
        position: { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
      };
    })
    .filter((k): k is { frame: number; position: { x: number; y: number } } => k !== null);
  if (keyframes.length === 0) return 0;
  const firstBb = (kfs[0] as Record<string, unknown>).boundingBox as Record<string, number> | undefined;
  const region = firstBb
    ? { x: firstBb.x, y: firstBb.y, width: firstBb.width, height: firstBb.height }
    : { x: 0, y: 0, width: 1, height: 1 };
  const frameRate = Number(path?.frameRate ?? 30);
  getMotionTrackingBridge().ingestTrackingData(job.sourceClipId, keyframes, region, frameRate);
  return keyframes.length;
}

export async function applyGpuDataResult(
  output: AiKindOutput,
  raw: RawManifest,
  job: PendingGpuJob,
): Promise<void> {
  switch (output) {
    case "subtitles": {
      const n = await applySubtitles(raw, job);
      if (n > 0) toast.success("Captions added", `${n} caption${n === 1 ? "" : "s"} added to the timeline.`);
      else toast.warning("No captions", "The transcription returned no captions.");
      return;
    }
    case "scenes": {
      const n = applyScenes(raw, job);
      if (n > 0) toast.success("Scenes detected", `Added ${n} scene marker${n === 1 ? "" : "s"}.`);
      else toast.info("No scene changes", "No scene cuts were detected.");
      return;
    }
    case "highlights": {
      const n = await applyHighlights(raw, job);
      if (n > 0) toast.success("Highlights applied", `Trimmed the clip to ${n} highlight${n === 1 ? "" : "s"}.`);
      else toast.info("No highlights", "No highlights were found to apply.");
      return;
    }
    case "tracking": {
      const n = applyTracking(raw, job);
      if (n > 0) toast.success("Tracking ready", "Attach an element to it in the Motion Tracking panel.");
      else toast.warning("Tracking failed", "No track was produced for the selected region.");
      return;
    }
    case "media":
      return;
  }
}
