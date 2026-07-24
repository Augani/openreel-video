import type {
  MotionShaderCategory,
  MotionShaderDef,
  MotionShaderParamDef,
} from "@openreel/core";
import { validateMotionShaderSource } from "@openreel/core/motion/motion-shader-validator";
import { buildShaderAuthoringPrompt } from "./ai-shader-prompt";

export interface LlmMessage {
  readonly role: "user";
  readonly content: string;
}

export interface GenerateAiShaderDeps {
  readonly send: (messages: LlmMessage[]) => Promise<string>;
  readonly maxRepairs?: number;
}

export type GenerateAiShaderResult =
  | { readonly ok: true; readonly def: MotionShaderDef }
  | { readonly ok: false; readonly error: string };

interface ParsedShader {
  readonly name: string;
  readonly glsl: string;
  readonly params: readonly MotionShaderParamDef[];
}

const MAX_REPAIRS_CEILING = 4;

function extractJsonCandidate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced && typeof fenced[1] === "string" && fenced[1].trim() !== "") {
    return fenced[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return trimmed.slice(first, last + 1).trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}

function parseParam(value: unknown): MotionShaderParamDef | undefined {
  if (!isRecord(value)) return undefined;
  const rawName = typeof value.name === "string" ? value.name.trim() : "";
  const name = rawName.replace(/^u_/, "");
  if (name === "") return undefined;
  const label =
    typeof value.label === "string" && value.label.trim() !== ""
      ? value.label.trim()
      : name;
  const rawMin = finiteNumber(value.min) ?? 0;
  const rawMax = finiteNumber(value.max) ?? 1;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  const rawDefault = finiteNumber(value.default) ?? min;
  const rawStep = finiteNumber(value.step);
  const step = rawStep !== undefined && rawStep > 0 ? rawStep : 0.01;
  const control = value.control === "number" ? "number" : "slider";
  return {
    name,
    label,
    type: "number",
    min,
    max,
    default: clamp(rawDefault, min, max),
    step,
    control,
  };
}

function parseShaderPayload(raw: string): ParsedShader | undefined {
  const candidate = extractJsonCandidate(raw);
  if (candidate === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const glsl = typeof value.glsl === "string" ? value.glsl : "";
  if (glsl.trim() === "") return undefined;
  const name =
    typeof value.name === "string" && value.name.trim() !== ""
      ? value.name.trim()
      : "AI Shader";
  const params: MotionShaderParamDef[] = [];
  if (Array.isArray(value.params)) {
    for (const entry of value.params) {
      const parsed = parseParam(entry);
      if (parsed) params.push(parsed);
    }
  }
  return { name, glsl, params };
}

function kebab(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "shader" : slug;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function buildDef(
  parsed: ParsedShader,
  category: MotionShaderCategory,
): MotionShaderDef {
  return {
    id: `ai-${kebab(parsed.name)}-${shortHash(parsed.glsl)}`,
    name: parsed.name,
    category,
    glsl: parsed.glsl,
    params: parsed.params,
    origin: "generated",
  };
}

export async function generateAiShader(
  prompt: string,
  category: MotionShaderCategory,
  deps: GenerateAiShaderDeps,
): Promise<GenerateAiShaderResult> {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { ok: false, error: "Prompt is empty" };
  }
  const basePrompt = `${buildShaderAuthoringPrompt(category)}\n\nUser request: ${prompt.trim()}`;
  const requested = deps.maxRepairs ?? 2;
  const maxRepairs = Math.min(MAX_REPAIRS_CEILING, Math.max(0, Math.trunc(requested)));

  let lastError = "no attempts were made";
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const content =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nThe previous attempt failed to compile:\n${lastError}\nReturn corrected JSON.`;
    const reply = await deps.send([{ role: "user", content }]);
    const parsed = parseShaderPayload(reply);
    if (!parsed) {
      lastError = "response was not valid JSON matching {name, glsl, params}";
      continue;
    }
    const validation = validateMotionShaderSource(parsed.glsl, category);
    if (!validation.ok) {
      lastError = validation.error;
      continue;
    }
    return { ok: true, def: buildDef(parsed, category) };
  }
  return { ok: false, error: lastError };
}
