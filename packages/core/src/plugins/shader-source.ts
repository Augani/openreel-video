/**
 * WGSL assembly for plugin shaders.
 *
 * A plugin only writes
 *
 *   fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32>
 *
 * The host wraps it with the bindings, the generated `OrParams` struct (one
 * member per manifest parameter), a full-screen-triangle vertex stage and the
 * fragment entry. The plugin can therefore not change the pipeline layout.
 *
 * Available to the plugin:
 *   params.<key>        manifest parameters (see generateParamsStruct)
 *   host.resolution     frame size in pixels
 *   host.time           clip-local time in seconds
 *   host.frame          clip-local frame index at 30 fps
 *   orSample(uv)        bilinear sample of the input frame (straight alpha)
 *   orHash21(p)         deterministic hash in [0,1)
 *
 * Output is straight (non-premultiplied) RGBA.
 */

import { generateParamsStruct, type PluginManifest } from "./manifest";

export const MAX_SHADER_BYTES = 128 * 1024;
export const GPU_BYTES_PER_PIXEL = 4;

const PRELUDE = `
struct OrHost {
  resolution: vec2<f32>,
  time: f32,
  frame: f32,
}

@group(0) @binding(0) var orInput: texture_2d<f32>;
@group(0) @binding(1) var orSampler: sampler;
@group(0) @binding(2) var<uniform> host: OrHost;
@group(0) @binding(3) var<uniform> params: OrParams;

fn orSample(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(orInput, orSampler, uv, 0.0);
}

fn orHash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}
`;

const POSTLUDE = `
struct OrVsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn orVs(@builtin(vertex_index) index: u32) -> OrVsOut {
  let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  var out: OrVsOut;
  out.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn orFs(in: OrVsOut) -> @location(0) vec4<f32> {
  return effect(in.uv, orSample(in.uv));
}
`;

export interface AssembledShader {
  readonly code: string;
  /** Lines the host adds before the plugin source; subtract from compiler line numbers. */
  readonly lineOffset: number;
}

const FORBIDDEN: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /@\s*group\s*\(/, why: "plugins cannot declare @group bindings; use params/host/orSample" },
  { re: /@\s*binding\s*\(/, why: "plugins cannot declare @binding resources" },
  { re: /@\s*(vertex|fragment|compute)\b/, why: "plugins provide only fn effect(); the host owns the entry points" },
  { re: /\bfn\s+or(Vs|Fs)\b/, why: "orVs/orFs are reserved host entry points" },
  { re: /\bstruct\s+Or(Params|Host|VsOut)\b/, why: "OrParams/OrHost/OrVsOut are reserved host types" },
  { re: /\benable\s+/, why: "WGSL extensions (enable ...) are not allowed" },
];

/** Static checks that need no GPU. Returns human readable problems (empty when fine). */
export function lintPluginShader(wgsl: string): string[] {
  const problems: string[] = [];
  if (wgsl.length === 0) return ["shader is empty"];
  if (wgsl.length > MAX_SHADER_BYTES) problems.push(`shader exceeds ${MAX_SHADER_BYTES} bytes`);
  const stripped = wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (!/\bfn\s+effect\s*\(\s*\w+\s*:\s*vec2\s*<\s*f32\s*>\s*,\s*\w+\s*:\s*vec4\s*<\s*f32\s*>\s*\)\s*->\s*vec4\s*<\s*f32\s*>/.test(stripped)) {
    problems.push("shader must define fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32>");
  }
  for (const { re, why } of FORBIDDEN) if (re.test(stripped)) problems.push(why);
  return problems;
}

export function assemblePluginShader(
  manifest: Pick<PluginManifest, "parameters">,
  wgsl: string,
): AssembledShader {
  const head = `${generateParamsStruct(manifest)}${PRELUDE}\n`;
  return {
    code: `${head}${wgsl}\n${POSTLUDE}`,
    lineOffset: head.split("\n").length - 1,
  };
}

export interface ShaderDiagnostic {
  readonly type: "error" | "warning" | "info";
  readonly message: string;
  /** 1-based line in the plugin's own source (or 0 when it points into the host code). */
  readonly line: number;
  readonly column: number;
}

/** Map GPUCompilationMessage-like entries to plugin source lines. */
export function mapShaderDiagnostics(
  messages: ReadonlyArray<{ type: string; message: string; lineNum: number; linePos: number }>,
  lineOffset: number,
): ShaderDiagnostic[] {
  return messages.map((m) => ({
    type: m.type === "error" ? "error" : m.type === "warning" ? "warning" : "info",
    message: m.message,
    line: Math.max(0, m.lineNum - lineOffset),
    column: m.linePos,
  }));
}

export function formatShaderDiagnostics(diagnostics: readonly ShaderDiagnostic[]): string {
  return diagnostics
    .filter((d) => d.type === "error")
    .map((d) => (d.line > 0 ? `line ${d.line}:${d.column} ${d.message}` : d.message))
    .join("\n");
}
