import "../test/install-local-storage-mock";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GraphicsEngine,
  TitleEngine,
  createEffectFromPreset,
  isParticleEffect,
  type Project,
  type SVGClip,
  type StickerClip,
} from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useEngineStore } from "./engine-store";
import { createEmptyProject } from "./project/project-helpers";
import { autoSaveManager } from "../services/auto-save";
import {
  createProjectPackage,
  readProjectPackage,
} from "../services/project-package";

function fixture(): Project {
  const project = createEmptyProject("Complete saved overlays");
  const titles = new TitleEngine();
  const graphics = new GraphicsEngine();
  const text = titles.createTextClip({
    id: "title",
    trackId: "titles",
    startTime: 0,
    duration: 2,
    text: "Measured motion",
    style: {
      shader: {
        shaderId: "paper-mesh-gradient",
        params: { color1: "#ee44aa" },
        progress: 0.37,
      },
    },
  });
  const shape = graphics.createShape(
    {
      id: "shape",
      shapeType: "rectangle",
      width: 160,
      height: 90,
      style: {
        fill: { type: "solid", color: "#ff0000", opacity: 0 },
        stroke: { color: "#ffffff", width: 0, opacity: 0 },
      },
    },
    "graphics",
    0,
    2,
  );
  const svg: SVGClip = {
    id: "svg",
    trackId: "graphics",
    startTime: 0,
    duration: 2,
    type: "svg",
    transform: shape.transform,
    keyframes: [],
    svgContent: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>',
    viewBox: { minX: 0, minY: 0, width: 10, height: 10 },
    preserveAspectRatio: "xMidYMid",
    colorStyle: { colorMode: "tint", tintColor: "#00ff00", tintOpacity: 0 },
  };
  const sticker: StickerClip = {
    id: "sticker",
    trackId: "graphics",
    startTime: 0,
    duration: 2,
    type: "sticker",
    transform: shape.transform,
    keyframes: [],
    imageUrl: "data:image/png;base64,aGVsbG8=",
    name: "Saved sticker",
  };
  const particle = createEffectFromPreset(
    "confetti-celebration",
    "particles",
    text.id,
    0,
    2,
  )!;
  expect(isParticleEffect(particle)).toBe(true);
  return {
    ...project,
    textClips: [text],
    shapeClips: [shape],
    svgClips: [svg],
    stickerClips: [sticker],
    particleEffects: [particle],
  };
}

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({ project: fixture(), hasOpenProject: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("complete project snapshots without optional render engines", () => {
  it("round trips saved shaded text, zero-valued graphics, SVGs, stickers and particles in an actual package", async () => {
    const expected = useProjectStore.getState().project;
    const full = useProjectStore.getState().getFullProject();
    const restored = await readProjectPackage(await createProjectPackage(full));
    for (const key of [
      "textClips",
      "shapeClips",
      "svgClips",
      "stickerClips",
      "particleEffects",
    ] as const)
      expect(restored[key]).toEqual(expected[key]);
  });

  it("autosaves the complete canonical arrays before title or graphics engines are available", async () => {
    const expected = useProjectStore.getState().project;
    const save = vi.spyOn(autoSaveManager, "forceSave").mockResolvedValue();
    await useProjectStore.getState().forceSave();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(expected);
  });

  it("retains existing live-engine ownership, including deliberate deletion of every overlay", () => {
    useEngineStore.setState({
      titleEngine: new TitleEngine(),
      graphicsEngine: new GraphicsEngine(),
    });
    const full = useProjectStore.getState().getFullProject();
    expect(full.textClips).toEqual([]);
    expect(full.shapeClips).toEqual([]);
    expect(full.svgClips).toEqual([]);
    expect(full.stickerClips).toEqual([]);
    expect(full.particleEffects).toEqual(
      useProjectStore.getState().project.particleEffects,
    );
  });
});
