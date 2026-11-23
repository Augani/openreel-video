import { z } from "zod";

export const projectManagerOptionsSchema = z.object({
  mode: z.enum(["collect", "consolidate"]),
  sequenceIds: z.array(z.string().min(1)).min(1).max(500),
  preset: z.enum(["match-source", "prores-422-lt", "prores-422", "prores-422-hq", "dnxhr-sq", "dnxhr-hq", "h264"]),
  excludeUnused: z.boolean(),
  trim: z.boolean(),
  handleFrames: z.number().int().min(0).max(1000),
  includeProxies: z.boolean(),
  includeRenderFiles: z.boolean(),
  includeAudioConform: z.boolean(),
  renameToClipNames: z.boolean(),
});

/** The project is sent as the JSON the editor saves (media bytes are not part of it). */
const projectJson = z.string().min(2).max(512 * 1024 * 1024);

export const projectManagerEstimateArgsSchema = z.object({
  projectJson,
  options: projectManagerOptionsSchema,
  /** Parent folder chosen so far, to report its free space. */
  destParent: z.string().min(1).nullish(),
});

export const projectManagerStartArgsSchema = z.object({
  projectJson,
  options: projectManagerOptionsSchema,
  destParent: z.string().min(1),
  projectName: z.string().min(1).max(200).optional(),
});

export const projectManagerCancelArgsSchema = z.object({ jobId: z.string().min(1) });

export interface ProjectManagerEstimateResult {
  totalBytes: number;
  mediaBytes: number;
  proxyBytes: number;
  renderBytes: number;
  freeBytes: number | null;
  items: Array<{ mediaId: string; name: string; action: "copy" | "transcode" | "offline"; trimmed: boolean; keptSeconds: number; sourceSeconds: number; bytes: number; note?: string }>;
  droppedCount: number;
  warnings: string[];
}
