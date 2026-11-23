import { z } from "zod";
import type {
  CreationAssetRecipe,
  CreationScene,
} from "../../../../packages/core/src/creation/index";

export { CHANNELS } from "./channels";
export * from "./onboarding";

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
  /** Output channel count (a 5.1 sequence asks for the source's own channels, up to 6). Default 2. */
  channels: z.number().int().min(1).max(8).optional(),
});
/** Audio-only Dolby export: a WAV mixdown in, a raw AC-3 / E-AC-3 stream out. */
export const encodeDolbyAudioArgsSchema = z.object({
  wav: z.instanceof(ArrayBuffer),
  codec: z.enum(["ac3", "eac3"]),
  channels: z.union([z.literal(2), z.literal(6)]),
  bitrateKbps: z.number().int().min(32).max(2048),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]),
  dialnorm: z.number().int().min(-31).max(-1),
});
export const probeAudioArgsSchema = z.object({ srcPath: z.string() });
export const developRawStillArgsSchema = z.object({ srcPath: z.string().min(1) });
export const nativeProbeArgsSchema = z.object({ path: z.string().min(1) });
export const nativeFrameArgsSchema = z.object({
  path: z.string().min(1),
  time: z.number().finite(),
  width: z.number().int().positive().optional(),
  quality: z.enum(["preview", "full"]).default("preview"),
  /** 16 returns little-endian rgba64 code values (HDR working mode). Absent: 8-bit rgba. */
  bitDepth: z.union([z.literal(8), z.literal(16)]).optional(),
});
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

const riggingWarningSchema = z.object({
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
  service: z.enum([
    "elevenlabs",
    "openai",
    "anthropic",
    "openai-compatible",
    "anthropic-compatible",
  ]),
  path: z.string(),
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  baseUrl: z.string().optional(),
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

const auroraSequenceRenderArgsSchema = z.object({
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

const linkedCompId = z.string().min(1).max(200);
export const linkedCompOpenArgsSchema = z.object({ compositionId: linkedCompId });
/**
 * Messages relayed between the editor window and a linked-composition window. The
 * template is validated by the receiving renderer (it owns the template schema);
 * main only checks the envelope and relays it.
 */
export const linkedCompMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), compositionId: linkedCompId }),
  z.object({ type: z.literal("closed"), compositionId: linkedCompId }),
  z.object({ type: z.literal("gone"), compositionId: linkedCompId }),
  z.object({
    type: z.literal("edit"),
    compositionId: linkedCompId,
    baseRevision: z.number().finite(),
    label: z.string().max(200),
    template: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("state"),
    compositionId: linkedCompId,
    name: z.string().max(500),
    revision: z.number().finite(),
    template: z.record(z.unknown()),
    rejected: z.string().max(1000).optional(),
  }),
]);
export type LinkedCompMessage = z.infer<typeof linkedCompMessageSchema>;
/** Largest relayed message (a template embeds its images as data: URLs). */
export const LINKED_COMP_MAX_MESSAGE_BYTES = 16_000_000;

export const windowControlArgsSchema = z.object({
  action: z.enum(["minimize", "toggleMaximize", "close"]),
});

export const ingestProfileSchema = z.object({
  codec: z.enum(["prores-proxy", "prores-lt", "prores-422", "h264", "dnxhr-lb", "dnxhr-sq"]),
  size: z.enum(["full", "half", "quarter", "720p", "1080p", "custom"]),
  customWidth: z.number().int().min(16).max(16384).optional(),
  audio: z.enum(["keep", "strip"]).optional(),
  burnIn: z.object({ clipName: z.boolean().optional(), timecode: z.boolean().optional() }).optional(),
  destination: z.object({ mode: z.enum(["project", "media", "custom"]), folder: z.string().min(1).optional() }).optional(),
});
export const ingestChecksumSchema = z.enum(["sha256", "md5", "xxh64"]);

const ingestConfigSchema = z
  .object({
    proxyProfile: ingestProfileSchema.optional(),
    proxyFolder: z.string().min(1).optional(),
    mediaFolder: z.string().min(1).optional(),
    concurrency: z.union([z.literal(1), z.literal(2)]).optional(),
    proxiesWithCopy: z.boolean().optional(),
    checksum: ingestChecksumSchema.optional(),
    proxyPresetId: z.string().min(1).max(80).optional(),
  })
  .nullish();

const ingestProjectSchema = z.object({
  projectId: z.string().min(1).max(200),
  /** Absolute path of the saved project file; absent for a project that was never saved. */
  projectPath: z.string().min(1).nullish(),
  config: ingestConfigSchema,
});

export const ingestResolveFoldersArgsSchema = ingestProjectSchema;
export const ingestProxyEnqueueArgsSchema = ingestProjectSchema.extend({
  items: z
    .array(
      z.object({
        mediaId: z.string().min(1),
        name: z.string().min(1),
        srcPath: z.string().min(1),
        profile: ingestProfileSchema,
        previewTwin: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
  force: z.boolean().optional(),
});
/** Queue verified copies into the project's Media folder as background jobs (optionally followed by proxies). */
export const ingestCopyEnqueueArgsSchema = ingestProjectSchema.extend({
  items: z.array(z.object({ mediaId: z.string().min(1), name: z.string().min(1), srcPath: z.string().min(1) })).min(1).max(500),
  algorithm: ingestChecksumSchema.optional(),
  /** Build proxies from each copy once it is verified. */
  thenProxies: z.object({ profile: ingestProfileSchema, previewTwin: z.boolean() }).optional(),
});
export const ingestProxyListArgsSchema = z.object({ projectId: z.string().min(1) });
export const ingestProxyIdsArgsSchema = z.object({ ids: z.array(z.string().min(1)).max(1000) });
export const ingestProxySetConcurrencyArgsSchema = z.object({ concurrency: z.number().int().min(1).max(2) });
export const ingestStatArgsSchema = z.object({ paths: z.array(z.string().min(1)).max(2000) });
export const ingestReadProxyArgsSchema = z.object({ path: z.string().min(1) });
export const ingestCopyToProjectArgsSchema = ingestProjectSchema.extend({
  requestId: z.string().min(1).max(100),
  algorithm: ingestChecksumSchema.optional(),
  srcPath: z.string().min(1),
});
export const ingestPickFolderArgsSchema = z.object({ title: z.string().max(200).optional(), defaultPath: z.string().optional() });
export const ingestScanFolderArgsSchema = z.object({
  root: z.string().min(1),
  names: z.array(z.string().min(1)).min(1).max(5000),
  mode: z.enum(["media", "proxy"]),
  /** Proxy name pattern with one {name} (`{name}_proxy`); absent = the usual suffixes. */
  proxyPattern: z.string().max(200).optional(),
});

const mediaBrowserClipSchema = z.object({
  name: z.string().min(1).max(300),
  kind: z.string().min(1).max(40),
  segments: z
    .array(z.object({ path: z.string().min(1), audioPaths: z.array(z.string().min(1)).max(32).optional() }))
    .min(1)
    .max(200),
});
export const mediaBrowserListArgsSchema = z.object({ path: z.string().min(1), rawFolders: z.boolean().optional() });
export const mediaBrowserThumbnailArgsSchema = z.object({ path: z.string().min(1), time: z.number().min(0).max(1e6).optional(), width: z.number().int().min(32).max(1280).optional() });
export const mediaBrowserFilmstripArgsSchema = z.object({ clip: mediaBrowserClipSchema, count: z.number().int().min(2).max(24).optional(), width: z.number().int().min(32).max(640).optional() });
export const mediaBrowserClipArgsSchema = z.object({ clip: mediaBrowserClipSchema });
export const mediaBrowserReadXmpArgsSchema = z.object({ path: z.string().min(1) });
export const mediaBrowserWriteSidecarArgsSchema = z.object({
  path: z.string().min(1),
  fields: z.object({
    title: z.string().max(10000).optional(),
    description: z.string().max(100000).optional(),
    creator: z.string().max(10000).optional(),
    rights: z.string().max(10000).optional(),
    keywords: z.array(z.string().max(500)).max(1000).optional(),
    scene: z.string().max(1000).optional(),
    shot: z.string().max(1000).optional(),
    take: z.string().max(1000).optional(),
    good: z.boolean().optional(),
    logComment: z.string().max(100000).optional(),
    reel: z.string().max(1000).optional(),
  }),
});
