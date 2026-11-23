import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOcioFull, type OcioConfig } from "./config";
import { OcioContext } from "./compile";
import { registerAcesOutputBuiltins } from "./builtins-aces";
import { registerFixedFunctions } from "./fixed";

/** Shared by the OCIO runtime tests: fixture loading and the OpenColorIO reference cases (see scripts/ocio/make-reference.py). */

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export interface ReferenceCase {
  cfg: "handmade" | "studio" | "cg";
  kind: "cs" | "look" | "dv";
  a: string;
  b: string;
  c: string | null;
  in: "code" | "scene";
  out: number[];
}

export interface ReferenceFile {
  ocioVersion: string;
  inputs: { code: number[]; scene: number[] };
  cases: ReferenceCase[];
}

export function readReference(): ReferenceFile {
  return JSON.parse(readFileSync(join(FIXTURES, "ocio-reference.json"), "utf8")) as ReferenceFile;
}

function walk(dir: string, base: string, out: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${base}${name}/`, out);
    else if (name !== "config.ocio") out[`${base}${name}`] = readFileSync(full, "utf8");
  }
}

export interface LoadedConfig {
  readonly text: string;
  readonly config: OcioConfig;
  readonly files: Record<string, string>;
  readonly ctx: OcioContext;
}

export function loadFixtureConfig(name: "handmade" | "studio" | "cg"): LoadedConfig {
  registerFixedFunctions();
  registerAcesOutputBuiltins();
  const files: Record<string, string> = {};
  let text: string;
  if (name === "handmade") {
    text = readFileSync(join(FIXTURES, "handmade", "config.ocio"), "utf8");
    walk(join(FIXTURES, "handmade"), "", files);
  } else {
    text = readFileSync(join(FIXTURES, name === "studio" ? "studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio" : "cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio"), "utf8");
  }
  const config = parseOcioFull(text);
  return { text, config, files, ctx: new OcioContext(config, files) };
}
