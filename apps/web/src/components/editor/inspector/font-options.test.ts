import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import {
  compareRegisteredFont,
  createCustomFontReader,
  isCustomFontRegistered,
  registerEmbeddedFont,
} from "./font-options";
import { registerPackagedFonts } from "../../../services/font-embedding";
import { createBrowserFontAvailability, findMissingProjectFonts } from "../../../services/project-fonts";
import { createEmptyProject } from "../../../stores/project/project-helpers";

const faces = new Set<{ family: string }>();

class FakeFontFace {
  constructor(
    public family: string,
    public source: ArrayBuffer,
  ) {}
  async load() {
    return this;
  }
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function projectUsing(family: string) {
  const base = createEmptyProject("Fonts");
  const textClips = [
    { id: "t", trackId: "x", startTime: 0, duration: 1, text: "Hi", keyframes: [], style: { fontFamily: family, fontSize: 40, fontWeight: "normal" } },
  ] as unknown as NonNullable<typeof base.textClips>;
  return { ...base, textClips };
}

function availability() {
  const real = createBrowserFontAvailability({ measureContext: null, fontFaces: () => Array.from(faces) });
  return { isBuiltIn: () => false, isInstalled: () => false, isLoaded: real.isLoaded };
}

beforeEach(() => {
  faces.clear();
  vi.stubGlobal("FontFace", FakeFontFace);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", undefined);
  vi.stubGlobal("document", {
    fonts: { add: (face: { family: string }) => faces.add(face), [Symbol.iterator]: () => faces[Symbol.iterator]() },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedded font registration", () => {
  it("registers packaged fonts with document.fonts so the missing-font check stays quiet", async () => {
    const project = projectUsing("Packaged Brand");
    expect(findMissingProjectFonts(project, availability()).map((m) => m.family)).toEqual(["Packaged Brand"]);

    await registerPackagedFonts([{ family: "Packaged Brand", data: new Blob([new Uint8Array([1, 2, 3])]), readOnly: false }], {
      compare: compareRegisteredFont,
      register: (family, data, options) => registerEmbeddedFont(family, data, { readOnly: options.readOnly }),
    });

    expect(Array.from(faces).map((f) => f.family)).toContain("Packaged Brand");
    expect(findMissingProjectFonts(project, availability())).toEqual([]);
  });

  it("registers read-only fonts for rendering only: not persisted, not editable", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    await registerEmbeddedFont("Print Only", bytes(4, 4), { readOnly: true });
    expect(Array.from(faces).map((f) => f.family)).toContain("Print Only");
    expect(open).not.toHaveBeenCalled();
    expect(findMissingProjectFonts(projectUsing("Print Only"), availability())).toEqual([]);
  });

  it("detects a different font file registered under the same family name", async () => {
    await registerEmbeddedFont("Same Name", bytes(1, 2), { readOnly: true });
    expect(isCustomFontRegistered("Same Name")).toBe(true);
    expect(await compareRegisteredFont("Same Name", bytes(1, 2))).toBe("same");
    expect(await compareRegisteredFont("Same Name", bytes(9, 9))).toBe("different");
    expect(await compareRegisteredFont("Never Seen", bytes(1))).toBe("absent");
    const reader = await createCustomFontReader();
    expect(reader.isUserFont("Same Name")).toBe(true);
  });
});
