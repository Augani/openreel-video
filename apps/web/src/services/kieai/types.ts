/**
 * KieAI API — shared types
 * Base URL: https://kieai.redpandaai.co
 */

// ─── Common response wrapper ────────────────────────────────────────────────

export interface KieAIResponse<T> {
  readonly success: boolean;
  readonly code: number;
  readonly msg: string;
  readonly data: T;
}

// ─── File upload ─────────────────────────────────────────────────────────────

export interface UploadedFile {
  readonly fileId: string;
  readonly fileName: string;
  readonly originalName: string;
  readonly fileSize: number;
  readonly mimeType: string;
  readonly uploadPath: string;
  readonly fileUrl: string;
  readonly downloadUrl: string;
  readonly uploadTime: string;   // ISO 8601
  readonly expiresAt: string;    // ISO 8601 — files auto-deleted after 3 days
}

export type FileUploadResponse = KieAIResponse<UploadedFile>;

/** Shared optional parameters for all upload methods */
export interface UploadOptions {
  /** Server-side directory to place the file in (optional) */
  uploadPath?: string;
  /**
   * Custom filename on the server. Omit to auto-generate.
   * Warning: overwrites any existing file with the same name.
   */
  fileName?: string;
}

/** Options for URL-based upload */
export interface UrlUploadOptions extends UploadOptions {
  /** Publicly accessible URL of the file to download and store */
  fileUrl: string;
}

/** Options for Base64 upload */
export interface Base64UploadOptions extends UploadOptions {
  /**
   * Base64-encoded file content.
   * Must include MIME type prefix, e.g. `data:image/jpeg;base64,<data>`
   * Recommended max size: 10 MB (expands ~33% in transit).
   */
  base64Data: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class KieAIError extends Error {
  readonly code: number;
  readonly msg: string;

  constructor(code: number, msg: string) {
    super(`KieAI error ${code}: ${msg}`);
    this.name = "KieAIError";
    this.code = code;
    this.msg = msg;
  }
}
