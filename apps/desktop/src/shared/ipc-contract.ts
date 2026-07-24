import { z } from "zod";
import type {
  CreationAssetRecipe,
  CreationScene,
} from "../../../../packages/core/src/creation/index";

export { CHANNELS } from "./channels";

export const hardwareInfoSchema = z.object({
  cpu: z.object({
    model: z.string(),
    physicalCores: z.number().int().nonnegative(),
    logicalCores: z.number().int().nonnegative(),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    freeBytes: z.number().nonnegative(),
  }),
  gpus: z.array(z.string()),
  encoders: z.array(z.string()),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
});

export type HardwareInfo = z.infer<typeof hardwareInfoSchema>;

export const saveDialogArgsSchema = z.object({
  defaultPath: z.string(),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
});
export const openDialogArgsSchema = z.object({
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })),
});
export const writeFileArgsSchema = z.object({ path: z.string(), data: z.string() });
export const readFileArgsSchema = z.object({ path: z.string() });

export const proxyArgsSchema = z.object({
  srcPath: z.string(),
  preset: z.enum(["low", "medium", "high"]),
});
export const transcodeArgsSchema = z.object({
  srcPath: z.string(),
  container: z.enum(["mp4", "webm", "mov"]).default("mp4"),
  videoBitrateKbps: z.number().int().positive().default(5000),
  audioBitrateKbps: z.number().int().positive().default(192),
});
export const extractAudioArgsSchema = z.object({
  srcPath: z.string(),
  streamIndex: z.number().int().nonnegative().optional(),
});
export const probeAudioArgsSchema = z.object({ srcPath: z.string() });
export const fetchUrlArgsSchema = z.object({
  url: z.string().url(),
  maxBytes: z.number().int().positive().optional(),
});

export const riggingBackendModeSchema = z.enum(["configured", "bundled", "system"]);
export type RiggingBackendMode = z.infer<typeof riggingBackendModeSchema>;

export const riggingBackendProbeSchema = z.object({
  available: z.boolean(),
  provider: z.literal("blender"),
  mode: riggingBackendModeSchema.optional(),
  path: z.string().optional(),
  version: z.string().optional(),
  error: z.string().optional(),
});
export type RiggingBackendProbe = z.infer<typeof riggingBackendProbeSchema>;

export const riggingWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export const rigHumanoidModelArgsSchema = z.object({
  modelUrl: z.string().min(1),
  outputPath: z.string().optional(),
  name: z.string().optional(),
  heightMeters: z.number().positive().optional(),
  overwriteExisting: z.boolean().optional(),
});
export type RigHumanoidModelArgs = z.infer<typeof rigHumanoidModelArgsSchema>;

export const rigHumanoidModelResultSchema = z.object({
  ok: z.boolean(),
  provider: z.literal("blender"),
  inputUrl: z.string(),
  outputUrl: z.string().optional(),
  outputPath: z.string().optional(),
  armatureName: z.string().optional(),
  createdArmature: z.boolean(),
  preservedExistingArmature: z.boolean(),
  skinnedMeshCount: z.number().int().nonnegative(),
  meshCount: z.number().int().nonnegative(),
  boneCount: z.number().int().nonnegative(),
  warnings: z.array(riggingWarningSchema),
  error: z.string().optional(),
});
export type RigHumanoidModelResult = z.infer<typeof rigHumanoidModelResultSchema>;

export const cloudFetchArgsSchema = z.object({
  service: z.enum(["elevenlabs", "openai", "anthropic"]),
  path: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export interface AuroraRenderPreviewArgs {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly width: number;
  readonly height: number;
  readonly background?: string;
  readonly timeSeconds?: number;
  readonly quality?: "preview" | "final";
}

export const auroraRenderPreviewArgsSchema = z.object({
  scene: z.unknown(),
  assets: z.array(z.unknown()),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  background: z.string().optional(),
  timeSeconds: z.number().nonnegative().optional(),
  quality: z.enum(["preview", "final"]).optional(),
});

export interface AuroraPreviewSessionStartArgs extends AuroraRenderPreviewArgs {
  readonly sessionId?: string;
}

export const auroraPreviewSessionStartArgsSchema = auroraRenderPreviewArgsSchema.extend({
  sessionId: z.string().min(1).max(128).optional(),
});

export const auroraPreviewSessionStartResultSchema = z.object({
  sessionId: z.string().min(1).max(128),
});
export type AuroraPreviewSessionStartResult = z.infer<
  typeof auroraPreviewSessionStartResultSchema
>;

export const auroraRenderPreviewResultSchema = z.object({
  backend: z.enum(["native", "cpu"]),
  pngBase64: z.string(),
  dataUri: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coveredPixels: z.number().int().nonnegative(),
  shadowedPixels: z.number().int().nonnegative(),
  renderMs: z.number().nonnegative(),
});
export type AuroraRenderPreviewResult = z.infer<typeof auroraRenderPreviewResultSchema>;

export const auroraPreviewSessionCancelArgsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const auroraPreviewSessionEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("update"),
    sessionId: z.string().min(1).max(128),
    stage: z.enum(["draft", "refine", "final"]),
    progress: z.number().min(0).max(1),
    done: z.boolean(),
    targetWidth: z.number().int().positive(),
    targetHeight: z.number().int().positive(),
    result: auroraRenderPreviewResultSchema,
  }),
  z.object({
    kind: z.literal("error"),
    sessionId: z.string().min(1).max(128),
    done: z.literal(true),
    error: z.string(),
  }),
]);
export type AuroraPreviewSessionEvent = z.infer<
  typeof auroraPreviewSessionEventSchema
>;

export interface AuroraSequenceRenderArgs {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationSeconds: number;
  readonly background?: string;
  readonly quality?: "preview" | "final";
}

export const auroraSequenceRenderArgsSchema = z.object({
  scene: z.unknown(),
  assets: z.array(z.unknown()),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  frameRate: z.number().positive().max(240),
  durationSeconds: z.number().positive().max(7200),
  background: z.string().optional(),
  quality: z.enum(["preview", "final"]).optional(),
});

export interface AuroraSequenceSessionStartArgs extends AuroraSequenceRenderArgs {
  readonly sessionId?: string;
}

export const auroraSequenceSessionStartArgsSchema =
  auroraSequenceRenderArgsSchema.extend({
    sessionId: z.string().min(1).max(128).optional(),
  });

export const auroraSequenceSessionStartResultSchema = z.object({
  sessionId: z.string().min(1).max(128),
});
export type AuroraSequenceSessionStartResult = z.infer<
  typeof auroraSequenceSessionStartResultSchema
>;

export interface AuroraSequenceFrameResult {
  readonly backend: "native" | "cpu";
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
  readonly shadowedPixels: number;
  readonly renderMs: number;
}

export const auroraSequenceFrameResultSchema = z.object({
  backend: z.enum(["native", "cpu"]),
  rgba: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  coveredPixels: z.number().int().nonnegative(),
  shadowedPixels: z.number().int().nonnegative(),
  renderMs: z.number().nonnegative(),
});

export const auroraSequenceSessionCancelArgsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const auroraSequenceSessionEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("frame"),
    sessionId: z.string().min(1).max(128),
    frameIndex: z.number().int().nonnegative(),
    totalFrames: z.number().int().positive(),
    timeSeconds: z.number().nonnegative(),
    progress: z.number().min(0).max(1),
    done: z.boolean(),
    result: auroraSequenceFrameResultSchema,
  }),
  z.object({
    kind: z.literal("error"),
    sessionId: z.string().min(1).max(128),
    done: z.literal(true),
    error: z.string(),
  }),
]);
export type AuroraSequenceSessionEvent = z.infer<
  typeof auroraSequenceSessionEventSchema
>;

export const gpuUploadMediaArgsSchema = z.object({
  srcPath: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
});
export const gpuUploadExportArgsSchema = z.object({
  bytes: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
  filename: z.string(),
  contentType: z.string().optional(),
});
export const gpuSubmitJobArgsSchema = z.object({
  kind: z.string(),
  params: z.record(z.unknown()),
  mediaKey: z.string().optional(),
  mediaFilename: z.string().optional(),
});
export const gpuJobIdArgsSchema = z.object({ jobID: z.string() });
export const gpuArtifactArgsSchema = z.object({ jobID: z.string(), relativePath: z.string() });

export const windowControlArgsSchema = z.object({
  action: z.enum(["minimize", "toggleMaximize", "close"]),
});

export const audioStreamInfoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  channels: z.number().int(),
  sampleRate: z.number().int(),
  language: z.string().optional(),
});
export type AudioStreamInfo = z.infer<typeof audioStreamInfoSchema>;
