/**
 * KieAI File Upload API
 *
 * Three upload strategies, each suited to different use-cases:
 *
 *   uploadFileByUrl    — remote URL → KieAI storage (≤100 MB, 30 s timeout)
 *   uploadFileStream   — local File/Blob binary stream (best for >10 MB)
 *   uploadFileBase64   — base64-encoded string (≤10 MB, JSON-friendly)
 *
 * All methods return an `UploadedFile` describing the stored file.
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

const UPLOAD_URL_PATH    = "/api/file-url-upload";
const UPLOAD_STREAM_PATH = "/api/file-stream-upload";
const UPLOAD_BASE64_PATH = "/api/file-base64-upload";

/**
 * Upload a file from a publicly accessible URL.
 *
 * KieAI downloads the remote file and stores it on its servers.
 * Suitable for remote assets already on the internet.
 *
 * @param options.fileUrl  - Publicly accessible URL of the file (required)
 * @param options.uploadPath - Server-side directory (optional)
 * @param options.fileName   - Custom server filename (optional, overwrites existing)
 *
 * @example
 * const file = await uploadFileByUrl({
 *   fileUrl: "https://example.com/photo.jpg",
 * });
 * console.log(file.fileUrl); // KieAI-hosted URL
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
 * Upload a local File or Blob as a binary stream (multipart/form-data).
 *
 * Most efficient for large files (>10 MB). No base64 overhead.
 *
 * @param file           - The File or Blob to upload
 * @param options        - Optional uploadPath / fileName
 *
 * @example
 * const input = document.querySelector('input[type="file"]');
 * const file = await uploadFileStream(input.files[0]);
 * console.log(file.downloadUrl);
 */
export async function uploadFileStream(
  file: File | Blob,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  if (options.uploadPath) form.append("uploadPath", options.uploadPath);
  if (options.fileName)   form.append("fileName",   options.fileName);

  return kieaiPostForm<UploadedFile>(UPLOAD_STREAM_PATH, form);
}

/**
 * Upload a file as a base64-encoded string.
 *
 * Convenient when the file is already in base64 form (e.g. canvas export).
 * Keep files under 10 MB — base64 expands size by ~33%.
 *
 * The `base64Data` string must include the MIME type prefix:
 *   `data:image/jpeg;base64,<data>`
 *
 * @param options.base64Data - Base64 string with MIME prefix (required)
 * @param options.uploadPath - Server-side directory (optional)
 * @param options.fileName   - Custom server filename (optional)
 *
 * @example
 * const canvas = document.querySelector("canvas");
 * const base64Data = canvas.toDataURL("image/png");
 * const file = await uploadFileBase64({ base64Data, fileName: "frame.png" });
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
 * Convenience: choose the best upload strategy automatically.
 *
 * - Blob/File with size > 10 MB  → stream upload
 * - Blob/File with size ≤ 10 MB  → stream upload (still most efficient)
 * - string starting with "data:" → base64 upload
 * - string starting with "http"  → URL upload
 */
export async function uploadFile(
  source: File | Blob | string,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  if (typeof source === "string") {
    if (source.startsWith("data:")) {
      return uploadFileBase64({ ...options, base64Data: source });
    }
    return uploadFileByUrl({ ...options, fileUrl: source });
  }
  return uploadFileStream(source, options);
}
