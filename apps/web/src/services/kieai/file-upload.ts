/**
 * KieAI File Upload API
 *
 *   uploadFileStream  — browser sends File/Blob bytes directly to
 *                       KieAI via multipart/form-data. Works for any local
 *                       file regardless of size. Use this for media library
 *                       assets (images, videos, audio).
 *
 * Files are temporary: KieAI auto-deletes them after 3 days.
 *
 * Docs: https://docs.kie.ai/file-upload-api/quickstart
 */

import { kieaiPostForm } from "./client";
import type { UploadedFile, UploadOptions } from "./types";

const UPLOAD_STREAM_PATH = "/api/file-stream-upload";

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
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("uploadPath", options.uploadPath ?? "openreel");
  if (options.fileName) form.append("fileName", options.fileName);

  return kieaiPostForm<UploadedFile>(UPLOAD_STREAM_PATH, form, signal);
}
