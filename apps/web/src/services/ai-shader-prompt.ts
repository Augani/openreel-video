import type { MotionShaderCategory } from "@openreel/core";

const COMMON_CONTRACT = [
  "You author a single GLSL fragment shader for a WebGL2 motion graphics engine.",
  "Hard requirements (a compiler enforces these — violations are rejected):",
  "- First line must be exactly: #version 300 es",
  "- Declare: precision highp float;",
  "- Declare the varying: in vec2 vUv;",
  "- Declare the output: out vec4 fragColor;",
  "- These uniforms are always provided: uniform vec2 u_resolution; uniform float u_time;",
  "- Every parameter you define becomes a uniform float u_<name> that you must declare and use.",
  "- No unbounded or dynamically-bounded loops; keep the shader deterministic and cheap.",
].join("\n");

function categoryContract(category: MotionShaderCategory): string {
  if (category === "fill") {
    return [
      "This is a FILL shader.",
      "- MUST NOT declare or sample uniform sampler2D u_input.",
      "- Produce color procedurally from vUv, u_time, u_resolution and your params.",
    ].join("\n");
  }
  if (category === "effect") {
    return [
      "This is an EFFECT shader.",
      "- MUST declare: uniform sampler2D u_input;",
      "- Sample the source with texture(u_input, vUv) and transform it.",
    ].join("\n");
  }
  return [
    "This is a TEXT shader.",
    "- MUST declare: uniform sampler2D u_input;",
    "- MUST declare: uniform float u_progress;",
    "- u_progress animates 0..1; drive the reveal/animation with it.",
  ].join("\n");
}

const OUTPUT_CONTRACT = [
  "Respond with ONLY strict JSON, no prose, no markdown fences:",
  '{"name": string, "glsl": string, "params": [{"name": string, "label": string, "type": "number", "min": number, "max": number, "default": number, "step": number, "control": "slider" | "number"}]}',
  "- name: short human title.",
  "- params: 0 or more controllable floats; each name maps to a declared uniform float u_<name>.",
  "- min <= default <= max; step > 0.",
].join("\n");

export function buildShaderAuthoringPrompt(category: MotionShaderCategory): string {
  return [COMMON_CONTRACT, categoryContract(category), OUTPUT_CONTRACT].join("\n\n");
}
