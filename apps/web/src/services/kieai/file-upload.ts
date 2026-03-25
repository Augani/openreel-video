/**
 * KieAI File Upload API
 *
 * Two practical upload strategies for a local browser editor:
 *
 *   uploadFileStream  — PRIMARY: browser sends File/Blob bytes directly to
 *                       KieAI via multipart/form-data. Works for any local
 *                       file regardless of size. Use this for media library
 *                       assets (images, videos, audio).
 *
 *   uploadFileBase64  — For canvas/thumbnail exports already in base64 form.
 *                       Limited to ~10 MB due to base64 expansion overhead.
 *
 * NOTE: uploadFileByUrl is intentionally not the default here — KieAI's
 * server fetches the URL, so localhost:* URLs won't work. Only use it for
 * assets already hosted on a publicly reachable server.
 *
 * Files are temporary: KieAI auto-deletes them after 3 days.
 *
 * Docs: https://docs.kie.ai/file-upload-api/quickstart
 */

import { kieaiPostJson, kieaiPostForm } from "./client";
import type {
  UploadedFile,
  UrlUploadOptions,
  UploadOptions,
  Base64UploadOptions,
} from "./types";

const UPLOAD_STREAM_PATH = "/api/file-stream-upload";
const UPLOAD_BASE64_PATH = "/api/file-base64-upload";
const UPLOAD_URL_PATH    = "/api/file-url-upload";

/**
 * PRIMARY — Upload a local File or Blob as a binary stream.
 *
 * The browser sends the bytes directly to KieAI's server via
 * multipart/form-data. No size restrictions beyond server limits.
 * This is the right choice for media library assets.
 *
 * @param file    - File or Blob from a file picker, drag-drop, or canvas export
 * @param options - Optional uploadPath / fileName
 *
 * @example
 * // From media library item
 * const result = await uploadFileStream(mediaItem.blob, { fileName: "input.jpg" });
 * console.log(result.fileUrl); // pass to a KieAI generation API
 */
export async function uploadFileStream(
  file: File | Blob,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("uploadPath", options.uploadPath ?? "openreel");
  if (options.fileName) form.append("fileName", options.fileName);

  return kieaiPostForm<UploadedFile>(UPLOAD_STREAM_PATH, form);
}

/**
 * Upload a base64-encoded string (e.g. canvas.toDataURL output).
 *
 * Use for canvas frame exports or small thumbnails already in base64 form.
 * Keep under ~10 MB — base64 expands the payload by ~33%.
 *
 * The string must include the MIME prefix: `data:image/jpeg;base64,...`
 *
 * @example
 * const canvas = document.querySelector("canvas") as HTMLCanvasElement;
 * const result = await uploadFileBase64({
 *   base64Data: canvas.toDataURL("image/png"),
 *   fileName: "frame.png",
 * });
 */
export async function uploadFileBase64(
  options: Base64UploadOptions,
): Promise<UploadedFile> {
  return kieaiPostJson<Base64UploadOptions, UploadedFile>(
    UPLOAD_BASE64_PATH,
    options,
  );
}

/**
 * Upload from a publicly accessible URL.
 *
 * KieAI's server fetches the file at the given URL — localhost URLs will NOT
 * work. Only use this for assets already hosted on a public server (CDN, S3).
 *
 * @example
 * const result = await uploadFileByUrl({ fileUrl: "https://cdn.example.com/photo.jpg" });
 */
export async function uploadFileByUrl(
  options: UrlUploadOptions,
): Promise<UploadedFile> {
  return kieaiPostJson<UrlUploadOptions, UploadedFile>(
    UPLOAD_URL_PATH,
    options,
  );
}

/**
 * Convenience dispatcher — picks the right method automatically:
 *
 * - File | Blob              → uploadFileStream  (always preferred for local files)
 * - "data:..." string        → uploadFileBase64
 * - "http..." string         → uploadFileByUrl   (only if publicly reachable)
 */
export async function uploadFile(
  source: File | Blob | string,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  if (source instanceof Blob) {
    return uploadFileStream(source, options);
  }
  if (source.startsWith("data:")) {
    return uploadFileBase64({ ...options, base64Data: source });
  }
  return uploadFileByUrl({ ...options, fileUrl: source });
}
