/**
 * Manifest schema + validation (STUDIO_PLAN §6.2, §7). Every .fxpkg has a
 * manifest.json; the loader checks declared requirements before loading.
 */
import { z } from "zod";

export const ParamDeclSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["float", "int", "bool", "color", "enum", "vec2"]),
  label: z.string(),
  default: z.union([z.number(), z.boolean(), z.string(), z.tuple([z.number(), z.number()])]),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string()).optional(),
  internal: z.boolean().optional(),
});

export const RequirementsSchema = z.object({
  webgpu: z.boolean(),
  detection: z.array(z.enum(["subject_mask", "pose", "face", "depth"])),
  frame_history_depth: z.number().int().min(0),
  max_particles: z.number().int().min(0),
  uses_3d: z.boolean(),
  max_resolution: z.tuple([z.number(), z.number()]),
  perf_budget_ms_per_frame: z.number(),
  perf_budget_ms_detection: z.number(),
});

export const ManifestSchema = z.object({
  schema_version: z.string(),
  kind: z.enum(["template", "filter", "effect"]),
  id: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "id must be handle/slug"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver required"),
  abi: z.enum(["1.0", "1.1", "1.2"]),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  category: z.string().optional(),
  tags: z.array(z.string()).max(20).default([]),
  author: z.object({ handle: z.string(), creator_id: z.string() }),
  params: z.array(ParamDeclSchema).default([]),
  requirements: RequirementsSchema,
  license: z.string().default("MIT"),
  authoring: z
    .object({
      mode: z.enum(["blueprint", "advanced"]),
      blueprint_id: z.string().optional(),
      blueprint_version: z.string().optional(),
    })
    .optional(),
  checksums: z.record(z.string(), z.string()).default({}),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export interface ManifestValidationResult {
  ok: boolean;
  manifest?: Manifest;
  errors: Array<{ path: string; message: string }>;
}

export function validateManifest(input: unknown): ManifestValidationResult {
  const parsed = ManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Size limits enforced at submission (STUDIO_PLAN §6.2). */
export const SIZE_LIMITS = {
  totalPackage: 50 * 1024 * 1024,
  singleAsset: 10 * 1024 * 1024,
  spritesTotal: 20 * 1024 * 1024,
  meshesTotal: 25 * 1024 * 1024,
  audioTotal: 5 * 1024 * 1024,
  manifest: 256 * 1024,
  graphSource: 1024 * 1024,
} as const;

export interface SizeReport {
  ok: boolean;
  violations: Array<{ bound: string; size: number; limit: number }>;
}

export function checkSizes(files: Record<string, Uint8Array | string>): SizeReport {
  const violations: SizeReport["violations"] = [];
  const sizeOf = (v: Uint8Array | string) => (typeof v === "string" ? new TextEncoder().encode(v).length : v.length);

  let total = 0;
  let sprites = 0;
  let meshes = 0;
  let audio = 0;
  for (const [path, content] of Object.entries(files)) {
    const size = sizeOf(content);
    total += size;
    if (size > SIZE_LIMITS.singleAsset) violations.push({ bound: `single_asset:${path}`, size, limit: SIZE_LIMITS.singleAsset });
    if (path.startsWith("assets/sprites/")) sprites += size;
    if (path.startsWith("assets/meshes/")) meshes += size;
    if (path.startsWith("assets/audio/")) audio += size;
    if (path === "manifest.json" && size > SIZE_LIMITS.manifest) violations.push({ bound: "manifest", size, limit: SIZE_LIMITS.manifest });
    if (path === "source/graph.json" && size > SIZE_LIMITS.graphSource) violations.push({ bound: "graph_source", size, limit: SIZE_LIMITS.graphSource });
  }
  if (total > SIZE_LIMITS.totalPackage) violations.push({ bound: "total_package", size: total, limit: SIZE_LIMITS.totalPackage });
  if (sprites > SIZE_LIMITS.spritesTotal) violations.push({ bound: "sprites_total", size: sprites, limit: SIZE_LIMITS.spritesTotal });
  if (meshes > SIZE_LIMITS.meshesTotal) violations.push({ bound: "meshes_total", size: meshes, limit: SIZE_LIMITS.meshesTotal });
  if (audio > SIZE_LIMITS.audioTotal) violations.push({ bound: "audio_total", size: audio, limit: SIZE_LIMITS.audioTotal });

  return { ok: violations.length === 0, violations };
}
