import { normalizeResultManifest, primaryArtifact, MEDIA_OPTIONAL_KINDS } from "@openreel/core";
import { getWebGpuClient } from "./gpu-web-client";

export const TRANSIENT_GPU_CODES: ReadonlySet<number> = new Set([
  408, 429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);
const POLL_BASE_MS = 2000;
const BACKOFF_CAP_MS = 15000;

export function isTransientGpuError(err: { status?: number }): boolean {
  if (typeof err.status !== "number") return true;
  return TRANSIENT_GPU_CODES.has(err.status);
}

export function gpuBackoffMs(attempt: number, baseMs: number = POLL_BASE_MS): number {
  const factor = 1 << Math.max(0, Math.min(attempt, 4));
  return Math.min(baseMs * factor, BACKOFF_CAP_MS);
}

export function isDesktopGpuAvailable(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop" && !!window.openreel.gpu;
}

export function isWebGpuAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof fetch === "function" &&
    !isDesktopGpuAvailable()
  );
}

export function isGpuAvailable(): boolean {
  return isDesktopGpuAvailable() || isWebGpuAvailable();
}

export interface SubmitClipJobArgs {
  kind: string;
  params: Record<string, unknown>;
  srcPath?: string;
  filename?: string;
  contentType?: string;
  blob?: Blob;
}

export async function submitClipJob(args: SubmitClipJobArgs): Promise<{ jobID: string }> {
  if (isDesktopGpuAvailable()) {
    return submitClipJobDesktop(args);
  }
  if (isWebGpuAvailable()) {
    return submitClipJobWeb(args);
  }
  throw new Error("GPU jobs are not available in this environment");
}

async function submitClipJobDesktop(args: SubmitClipJobArgs): Promise<{ jobID: string }> {
  const gpu = window.openreel!.gpu;
  let mediaKey: string | undefined;
  let mediaFilename: string | undefined;
  if (args.srcPath && args.filename) {
    const uploaded = await gpu.uploadMedia({
      srcPath: args.srcPath,
      filename: args.filename,
      contentType: args.contentType,
    });
    mediaKey = uploaded.mediaKey;
    mediaFilename = args.filename;
  } else if (!MEDIA_OPTIONAL_KINDS.has(args.kind)) {
    throw new Error(`kind ${args.kind} requires media`);
  }
  const created = await gpu.submitJob({ kind: args.kind, params: args.params, mediaKey, mediaFilename });
  return { jobID: created.jobID };
}

async function submitClipJobWeb(args: SubmitClipJobArgs): Promise<{ jobID: string }> {
  const client = getWebGpuClient();
  let mediaKey: string | undefined;
  let mediaFilename: string | undefined;
  if (args.blob && args.filename) {
    const uploaded = await client.uploadMedia({
      blob: args.blob,
      filename: args.filename,
      contentType: args.contentType,
    });
    mediaKey = uploaded.mediaKey;
    mediaFilename = args.filename;
  } else if (!MEDIA_OPTIONAL_KINDS.has(args.kind)) {
    throw new Error(`kind ${args.kind} requires media`);
  }
  const created = await client.submitJob({ kind: args.kind, params: args.params, mediaKey, mediaFilename });
  return { jobID: created.jobID };
}

export { normalizeResultManifest, primaryArtifact };
