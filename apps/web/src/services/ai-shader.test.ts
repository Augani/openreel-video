import { describe, it, expect } from "vitest";
import { generateAiShader } from "./ai-shader";
import { buildShaderAuthoringPrompt } from "./ai-shader-prompt";

describe("generateAiShader", () => {
  it("returns a def when the model emits valid JSON", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(vUv,0.0,1.0); }";
    const send = async (): Promise<string> =>
      JSON.stringify({ name: "Foil", glsl, params: [] });
    const r = await generateAiShader("holographic foil", "fill", { send });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.def.category).toBe("fill");
      expect(r.def.origin).toBe("generated");
      expect(r.def.id.startsWith("ai-")).toBe(true);
    }
  });

  it("repairs after a compile/contract failure", async () => {
    const bad = "#version 300 es\nvoid main(){}";
    const good =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }";
    let n = 0;
    const send = async (): Promise<string> =>
      JSON.stringify({ name: "X", glsl: n++ === 0 ? bad : good, params: [] });
    const r = await generateAiShader("x", "fill", { send, maxRepairs: 1 });
    expect(r.ok).toBe(true);
  });

  it("fails after exhausting retries", async () => {
    const send = async (): Promise<string> =>
      JSON.stringify({ name: "X", glsl: "nonsense", params: [] });
    expect((await generateAiShader("x", "fill", { send, maxRepairs: 1 })).ok).toBe(false);
  });

  it("strips ```json fences before parsing", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }";
    const send = async (): Promise<string> =>
      "```json\n" + JSON.stringify({ name: "Fenced", glsl, params: [] }) + "\n```";
    const r = await generateAiShader("fenced", "fill", { send });
    expect(r.ok).toBe(true);
  });

  it("extracts a fenced json block wrapped in surrounding prose", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }";
    const send = async (): Promise<string> =>
      "Sure, here is your shader:\n\n```json\n" +
      JSON.stringify({ name: "Prose", glsl, params: [] }) +
      "\n```\n\nLet me know if you want tweaks.";
    const r = await generateAiShader("prose", "fill", { send });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.def.name).toBe("Prose");
  });

  it("normalizes an inverted param range to min<=max with default in range", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nuniform float u_amount;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(u_amount); }";
    const send = async (): Promise<string> =>
      JSON.stringify({
        name: "Inverted",
        glsl,
        params: [
          {
            name: "u_amount",
            label: "Amount",
            type: "number",
            min: 1,
            max: 0,
            default: 0.25,
            step: 0.05,
            control: "slider",
          },
        ],
      });
    const r = await generateAiShader("inverted", "fill", { send });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const param = r.def.params[0];
      expect(param?.min).toBe(0);
      expect(param?.max).toBe(1);
      expect(param!.min).toBeLessThanOrEqual(param!.max);
      expect(param!.default).toBeGreaterThanOrEqual(param!.min);
      expect(param!.default).toBeLessThanOrEqual(param!.max);
    }
  });

  it("passes the previous error back into the repair prompt", async () => {
    const good =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(1.0); }";
    const seen: string[] = [];
    let n = 0;
    const send = async (messages: { role: "user"; content: string }[]): Promise<string> => {
      seen.push(messages[messages.length - 1]?.content ?? "");
      return JSON.stringify({
        name: "X",
        glsl: n++ === 0 ? "#version 300 es\nvoid main(){}" : good,
        params: [],
      });
    };
    const r = await generateAiShader("x", "fill", { send, maxRepairs: 1 });
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(2);
    expect(seen[1]).toContain("fragColor");
  });

  it("clamps supplied params into their range", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nuniform float u_amount;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(u_amount); }";
    const send = async (): Promise<string> =>
      JSON.stringify({
        name: "Clamped",
        glsl,
        params: [
          {
            name: "u_amount",
            label: "Amount",
            type: "number",
            min: 0,
            max: 1,
            default: 5,
            step: 0.01,
            control: "slider",
          },
        ],
      });
    const r = await generateAiShader("clamped", "fill", { send });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.def.params).toHaveLength(1);
      expect(r.def.params[0]?.default).toBe(1);
    }
  });

  it("strips a leading u_ from a param name so the uniform binds", async () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nuniform float u_amount;\nout vec4 fragColor;\nvoid main(){ fragColor=vec4(u_amount); }";
    const send = async (): Promise<string> =>
      JSON.stringify({
        name: "Prefixed",
        glsl,
        params: [
          {
            name: "u_amount",
            label: "Amount",
            type: "number",
            min: 0,
            max: 1,
            default: 0.5,
            step: 0.01,
            control: "slider",
          },
        ],
      });
    const r = await generateAiShader("prefixed", "fill", { send });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.def.params).toHaveLength(1);
      expect(r.def.params[0]?.name).toBe("amount");
    }
  });

  it("fails when the model returns unparseable non-JSON every time", async () => {
    const send = async (): Promise<string> => "sorry I cannot help with that";
    const r = await generateAiShader("x", "fill", { send, maxRepairs: 1 });
    expect(r.ok).toBe(false);
  });
});

describe("buildShaderAuthoringPrompt", () => {
  it("includes the category-specific contract and strict-JSON directive", () => {
    const fill = buildShaderAuthoringPrompt("fill");
    expect(fill).toContain("#version 300 es");
    expect(fill).toContain("out vec4 fragColor");
    expect(fill.toLowerCase()).toContain("json");
    expect(fill).toContain("MUST NOT");

    const effect = buildShaderAuthoringPrompt("effect");
    expect(effect).toContain("sampler2D u_input");

    const text = buildShaderAuthoringPrompt("text");
    expect(text).toContain("u_progress");
  });
});
