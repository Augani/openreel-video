import { describe, expect, it } from "vitest";
import { HDR_SHADER_SOURCES } from "./hdr-gpu";

describe("HDR effect shader (source checks; the shaders themselves have not run on a GPU here)", () => {
  it("the glow combine writes straight colour once: it must not pass through finish(), which divides by alpha again", () => {
    const src = HDR_SHADER_SOURCES.effect;
    const combine = src.slice(src.indexOf("vec4 orig = texelFetch(u_orig"));
    expect(combine).toContain("lit / alpha");
    expect(combine).not.toMatch(/finish\s*\(/);
  });
});
