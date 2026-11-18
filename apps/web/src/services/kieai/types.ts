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
