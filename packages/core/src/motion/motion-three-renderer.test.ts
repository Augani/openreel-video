import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  classifyEnvironmentUrl,
  DEFAULT_MOTION_RENDER_QUALITY,
  mergeMotionRenderQuality,
  resolveEnvironmentPreset,
  resolveEnvironmentSource,
  resolveMotionToneMapping,
} from "./motion-three-renderer";

describe("mergeMotionRenderQuality", () => {
  it("fills EEVEE-class defaults when no overrides are given", () => {
    const quality = mergeMotionRenderQuality();
    expect(quality.toneMapping).toBe("agx");
    expect(quality.antialiasSamples).toBe(4);
    expect(quality.exposure).toBe(1);
    expect(quality.softLighting).toBe(true);
    expect(quality.environmentIntensity).toBeGreaterThan(0);
    expect(quality).toEqual(DEFAULT_MOTION_RENDER_QUALITY);
  });

  it("applies overrides while preserving the remaining defaults", () => {
    const quality = mergeMotionRenderQuality({
      toneMapping: "aces",
      antialiasSamples: 8,
    });
    expect(quality.toneMapping).toBe("aces");
    expect(quality.antialiasSamples).toBe(8);
    expect(quality.shadows).toBe(DEFAULT_MOTION_RENDER_QUALITY.shadows);
    expect(quality.postProcessing).toBe(DEFAULT_MOTION_RENDER_QUALITY.postProcessing);
  });
});

describe("resolveMotionToneMapping", () => {
  it("maps AgX as the Blender-look default", () => {
    expect(resolveMotionToneMapping(undefined)).toBe(THREE.AgXToneMapping);
    expect(resolveMotionToneMapping("agx")).toBe(THREE.AgXToneMapping);
  });

  it("maps the remaining named transforms to their three.js constants", () => {
    expect(resolveMotionToneMapping("aces")).toBe(THREE.ACESFilmicToneMapping);
    expect(resolveMotionToneMapping("neutral")).toBe(THREE.NeutralToneMapping);
    expect(resolveMotionToneMapping("filmic")).toBe(THREE.CineonToneMapping);
    expect(resolveMotionToneMapping("linear")).toBe(THREE.LinearToneMapping);
    expect(resolveMotionToneMapping("none")).toBe(THREE.NoToneMapping);
  });
});

describe("resolveEnvironmentPreset", () => {
  it("keeps the neutral studio room as a PMREM room environment", () => {
    const descriptor = resolveEnvironmentPreset("studio", 0.85);
    expect(descriptor.kind).toBe("room");
    expect(descriptor.intensity).toBeCloseTo(0.85);
  });

  it("disables lighting for the none preset", () => {
    expect(resolveEnvironmentPreset("none", 0.85).kind).toBe("none");
  });

  it("dims the room for the dark preset", () => {
    const dark = resolveEnvironmentPreset("dark", 0.85);
    expect(dark.kind).toBe("room");
    expect(dark.intensity).toBeLessThan(0.85);
  });

  it("builds a colored gradient sky for image-based presets", () => {
    const sunset = resolveEnvironmentPreset("sunset", 0.85);
    expect(sunset.kind).toBe("gradient");
    expect(sunset.gradient).toBeDefined();
    expect(sunset.gradient?.horizon).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(sunset.gradient?.zenith).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(sunset.gradient?.ground).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("classifyEnvironmentUrl", () => {
  it("detects radiance HDR and OpenEXR by extension, ignoring query strings", () => {
    expect(classifyEnvironmentUrl("https://cdn/x/studio.hdr")).toBe("hdr");
    expect(classifyEnvironmentUrl("https://cdn/x/studio.HDR?v=2")).toBe("hdr");
    expect(classifyEnvironmentUrl("https://cdn/x/studio.exr")).toBe("exr");
  });

  it("treats common image formats as low-dynamic-range equirect", () => {
    expect(classifyEnvironmentUrl("https://cdn/x/sky.jpg")).toBe("ldr");
    expect(classifyEnvironmentUrl("https://cdn/x/sky.png")).toBe("ldr");
    expect(classifyEnvironmentUrl("https://cdn/x/sky.webp")).toBe("ldr");
  });

  it("returns null for empty or unusable urls", () => {
    expect(classifyEnvironmentUrl(undefined)).toBeNull();
    expect(classifyEnvironmentUrl("")).toBeNull();
    expect(classifyEnvironmentUrl("not-a-url")).toBeNull();
  });
});

describe("resolveEnvironmentSource", () => {
  it("prefers an explicit HDRI url over the preset, keeping the preset as fallback", () => {
    const source = resolveEnvironmentSource(
      { environment: "studio", environmentUrl: "https://cdn/env.hdr" },
      0.85,
    );
    expect(source.mode).toBe("url");
    expect(source.url).toBe("https://cdn/env.hdr");
    expect(source.urlKind).toBe("hdr");
    expect(source.preset.kind).toBe("room");
  });

  it("falls back to the preset when no url is given", () => {
    const source = resolveEnvironmentSource({ environment: "sunset" }, 0.85);
    expect(source.mode).toBe("preset");
    expect(source.preset.kind).toBe("gradient");
  });

  it("reports none when the preset is none and there is no url", () => {
    expect(resolveEnvironmentSource({ environment: "none" }, 0.85).mode).toBe("none");
  });

  it("honors the backdrop opt-in flag", () => {
    expect(resolveEnvironmentSource({ environmentBackground: true }, 0.85).background).toBe(true);
    expect(resolveEnvironmentSource({}, 0.85).background).toBe(false);
  });

  it("ignores an unusable url and falls through to the preset", () => {
    const source = resolveEnvironmentSource(
      { environment: "warm", environmentUrl: "garbage" },
      0.85,
    );
    expect(source.mode).toBe("preset");
    expect(source.preset.kind).toBe("gradient");
  });
});
