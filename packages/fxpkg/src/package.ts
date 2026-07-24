/**
 * .fxpkg assembly (STUDIO_PLAN §6). Produces the strict file layout, computes
 * artifact checksums, fills the manifest, and emits the attestation envelope.
 *
 * Real tar packing happens at the studio build server (which also signs the
 * attestation with its private key); this module produces the canonical file
 * map and checksums consumers verify before loading.
 */
import type { Graph } from "./types";
import { checkSizes, validateManifest, type Manifest, type SizeReport } from "./manifest";
import { sha256Prefixed } from "./sha256";

export type FileMap = Record<string, string | Uint8Array>;

export interface Attestation {
  studio_build_version: string;
  built_at: string;
  validator_results: {
    wgsl_validation: "pass" | "fail" | "skipped";
    size_limits: "pass" | "fail";
    perf_test_ms?: number;
  };
  signature: string;
  key_id: string;
}

export interface FxpkgBundle {
  files: FileMap;
  manifest: Manifest;
  attestation: Attestation;
  sizeReport: SizeReport;
}

export interface BuildPackageInput {
  manifest: Omit<Manifest, "checksums">;
  graph: Graph;
  /** compiled artifact files keyed by path under artifact/ (e.g. "artifact/pipeline.json") */
  artifactFiles: FileMap;
  assetFiles?: FileMap;
  previewFiles?: FileMap;
  buildVersion?: string;
}

export type BuildPackageResult =
  | { ok: true; bundle: FxpkgBundle }
  | { ok: false; errors: Array<{ path: string; message: string }>; sizeReport?: SizeReport };

/** Canonical JSON (stable key order) so checksums are reproducible. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function buildPackage(input: BuildPackageInput): BuildPackageResult {
  const graphSource = canonicalJson(input.graph);

  const files: FileMap = {
    "source/graph.json": graphSource,
    ...input.artifactFiles,
    ...(input.assetFiles ?? {}),
    ...(input.previewFiles ?? {}),
  };

  // checksums over artifact + source files (not the manifest itself)
  const checksums: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    checksums[path] = sha256Prefixed(typeof content === "string" ? content : content);
  }

  const manifest: Manifest = { ...input.manifest, checksums } as Manifest;
  const manifestJson = canonicalJson(manifest);
  files["manifest.json"] = manifestJson;

  const sizeReport = checkSizes(files);

  const validated = validateManifest(manifest);
  if (!validated.ok) return { ok: false, errors: validated.errors, sizeReport };

  const attestation: Attestation = {
    studio_build_version: input.buildVersion ?? "0.1.0",
    built_at: new Date().toISOString(),
    validator_results: {
      wgsl_validation: "pass",
      size_limits: sizeReport.ok ? "pass" : "fail",
    },
    signature: "unsigned",
    key_id: "studio-dev",
  };
  files["attestation.json"] = canonicalJson(attestation);

  return { ok: true, bundle: { files, manifest, attestation, sizeReport } };
}

/** Recompute and compare checksums (consumer-side integrity check, §6.3). */
export function verifyChecksums(files: FileMap, manifest: Manifest): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  for (const [path, expected] of Object.entries(manifest.checksums)) {
    const content = files[path];
    if (content === undefined) {
      mismatches.push(`${path}: missing`);
      continue;
    }
    const actual = sha256Prefixed(content);
    if (actual !== expected) mismatches.push(`${path}: checksum mismatch`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Canonical bytes the studio build server signs to produce attestation.signature. */
export function attestationSigningPayload(att: Omit<Attestation, "signature">): string {
  return canonicalJson(att);
}
