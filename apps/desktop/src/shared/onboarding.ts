import { z } from "zod";

/**
 * Frozen Phase 0 contract for first-run onboarding and the MCP windowless update.
 * Renderer-side mirrors of these types live in apps/web/src/types/global.d.ts
 * (the web app cannot import from the desktop package). Keep the two in sync.
 */

export const onboardingStatusSchema = z.enum(["unseen", "in-progress", "done", "skipped"]);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

/** What the main process persists in userData/onboarding.json so a cleared renderer profile does not re-onboard. */
export const onboardingMirrorSchema = z.object({
  v: z.literal(1),
  status: onboardingStatusSchema,
  skippedBy: z.enum(["user", "agent", "automation", "format"]).optional(),
  persona: z.enum(["pro", "ai", "learn", "agent"]).optional(),
  path: z.enum(["ai", "learn"]).optional(),
  completedAt: z.number().optional(),
});
export type OnboardingMirror = z.infer<typeof onboardingMirrorSchema>;

export interface OllamaModelInfo {
  name: string;
  sizeBytes?: number;
}
export interface OllamaProbeResult {
  reachable: boolean;
  models: OllamaModelInfo[];
  /** Short diagnostic only. Probe failures are silent in the UI. */
  error?: string;
}

export interface SampleClipInfo {
  id: string;
  name: string;
  kind: "video" | "audio";
  durationSec: number;
  width?: number;
  height?: number;
  sizeBytes: number;
  mimeType: string;
  license: string;
}
export interface SampleClipData {
  id: string;
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export const pickFilesArgsSchema = z
  .object({
    title: z.string().optional(),
    kinds: z.array(z.enum(["video", "audio", "image"])).optional(),
    multiple: z.boolean().optional(),
  })
  .optional();
export type PickFilesArgs = z.infer<typeof pickFilesArgsSchema>;
export interface PickFilesResult {
  canceled: boolean;
  paths: string[];
}

export interface McpClientInfo {
  name: string;
  version?: string;
  connectedAt: number;
  lastSeenAt: number;
}
export interface McpClientStatus {
  /** True once any client has completed `initialize` since the app started. */
  connected: boolean;
  clients: McpClientInfo[];
  initializeCount: number;
  /** Set when the MCP server failed to start; null otherwise. */
  startError: string | null;
}

export const mcpSetPolicyArgsSchema = z.object({
  allowedRoots: z.array(z.string()),
});
export type McpSetPolicyArgs = z.infer<typeof mcpSetPolicyArgsSchema>;
export interface McpPolicy {
  allowedRoots: string[];
  /** The default roots (Movies, Music, Pictures, Documents, Downloads, Desktop), for "reset to default". */
  defaultRoots: string[];
}

/** Stable MCP path-tool error codes (spec 6.1). */
export type McpFileErrorCode =
  | "NO_PROJECT"
  | "NO_WINDOW"
  | "NOT_FOUND"
  | "OUTSIDE_ALLOWED_ROOTS"
  | "UNSUPPORTED_TYPE"
  | "UNREADABLE"
  | "UNSUPPORTED"
  | "INVALID_PARAMS";

export const mcpFilesResolveArgsSchema = z.object({
  paths: z.array(z.string()).min(1).max(500),
  recursive: z.boolean().optional(),
  /** "read" checks existence and roots; "write" checks the parent directory and roots. */
  mode: z.enum(["read", "write"]).default("read"),
});
export type McpFilesResolveArgs = z.infer<typeof mcpFilesResolveArgsSchema>;
export interface McpFilesResolveResult {
  /** Folders are expanded: `resolved` lists files (kind "file"). `exists` is false for a write target that is not on disk yet. */
  resolved: { path: string; realPath: string; kind: "file" | "directory"; sizeBytes: number; exists?: boolean }[];
  rejected: { path: string; code: McpFileErrorCode; message: string }[];
}

/**
 * Main-side finalize of an export: copy (or move) an app temp export to a destination that passed
 * the allowed-roots check, and report its size and SHA-256 (streamed, so large files stay out of memory).
 */
export const mcpFilesPlaceOutputArgsSchema = z.object({
  /** An `openreel-export-*` file in the OS temp dir, as returned by fs.tempFilePath(ext, true). */
  from: z.string().min(1),
  /** Destination file. Omit to only measure `from` (size and SHA-256), copying nothing. */
  to: z.string().min(1).optional(),
  overwrite: z.boolean().optional(),
  /** Delete `from` after a successful copy. */
  move: z.boolean().optional(),
});
export type McpFilesPlaceOutputArgs = z.infer<typeof mcpFilesPlaceOutputArgsSchema>;
export type McpFilesPlaceOutputResult =
  | { ok: true; path: string; sizeBytes: number; sha256: string }
  | { ok: false; code: McpFileErrorCode; message: string };
