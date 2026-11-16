import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { deflateSync } from "node:zlib";
import {
  classifyFsType,
  planProjectFonts,
  readFontEmbeddingPermission,
  registerPackagedFonts,
} from "./font-embedding";
import { createEmptyProject } from "../stores/project/project-helpers";
import { makeSfnt, makeWoff } from "./font-fixtures";

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fsType parsing", () => {
  it("classifies the OS/2 embedding bits", () => {
    expect(classifyFsType(0)).toBe("installable");
    expect(classifyFsType(0x0002)).toBe("restricted");
    expect(classifyFsType(0x0004)).toBe("preview-print");
    expect(classifyFsType(0x0008)).toBe("editable");
    expect(classifyFsType(0x0102)).toBe("restricted");
    // bit 9: bitmap-only embedding does not permit embedding the outline file
    expect(classifyFsType(0x0200)).toBe("restricted");
    // bit 8: no-subsetting is irrelevant because the whole file is embedded
    expect(classifyFsType(0x0100)).toBe("installable");
  });

  it.each([
    [0, "installable"],
    [8, "editable"],
    [4, "preview-print"],
    [2, "restricted"],
  ] as const)("reads fsType %i from a TTF and an OTF", async (fsType, permission) => {
    for (const flavor of ["ttf", "otf"] as const) {
      expect(await readFontEmbeddingPermission(makeSfnt(fsType, flavor))).toEqual({ fsType, permission });
    }
  });

  it("reads fsType from stored and deflated WOFF tables", async () => {
    expect((await readFontEmbeddingPermission(makeWoff(2, false, deflateSync))).permission).toBe("restricted");
    expect((await readFontEmbeddingPermission(makeWoff(2, true, deflateSync))).permission).toBe("restricted");
    expect((await readFontEmbeddingPermission(makeWoff(4, true, deflateSync))).permission).toBe("preview-print");
  });

  it("reports unknown for non-font data and WOFF2", async () => {
    expect((await readFontEmbeddingPermission(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).permission).toBe("unknown");
    const woff2 = new Uint8Array(48);
    new DataView(woff2.buffer).setUint32(0, 0x774f4632);
    expect((await readFontEmbeddingPermission(woff2.buffer)).permission).toBe("unknown");
  });
});

function projectUsing(families: string[]) {
  const project = createEmptyProject("Fonts");
  return {
    ...project,
    textClips: families.map((family, index) => ({
      id: `t${index}`,
      trackId: "x",
      startTime: 0,
      duration: 1,
      text: `Clip ${family}`,
      style: { fontFamily: family, fontWeight: 400 },
    })),
  } as unknown as Parameters<typeof planProjectFonts>[0];
}

describe("planProjectFonts", () => {
  it("embeds permitted user fonts, excludes and reports restricted ones, records web fonts by URL", async () => {
    const files: Record<string, ArrayBuffer> = {
      "Brand Open": makeSfnt(0),
      "Brand Print": makeSfnt(4),
      "Brand Locked": makeSfnt(2),
    };
    const plan = await planProjectFonts(
      projectUsing(["Brand Open", "Brand Print", "Brand Locked", "Bangers", "Inter", "Comic Sans MS"]),
      async (family) => files[family] ?? null,
    );
    const status = Object.fromEntries(plan.entries.map((e) => [e.family, e.status]));
    expect(status).toEqual({
      "Brand Open": "embedded",
      "Brand Print": "embedded-readonly",
      "Brand Locked": "restricted",
      Bangers: "web",
      Inter: "bundled",
      "Comic Sans MS": "system",
    });
    expect([...plan.payloads.keys()].sort()).toEqual(["Brand Open", "Brand Print"]);
    expect(plan.entries.find((e) => e.family === "Bangers")?.url).toContain("fonts.googleapis.com");
    expect(plan.entries.find((e) => e.family === "Brand Locked")?.fsType).toBe(2);
  });
});

describe("registerPackagedFonts", () => {
  it("registers fonts that are not available and skips ones that are", async () => {
    const registered: string[] = [];
    const font = (family: string) => ({ family, data: new Blob([new Uint8Array([1])]), readOnly: false });
    const result = await registerPackagedFonts([font("New"), font("Have"), font("Bad")], {
      compare: (family) => (family === "Have" ? "same" : "absent"),
      register: async (family) => {
        if (family === "Bad") throw new Error("corrupt");
        registered.push(family);
      },
    });
    expect(registered).toEqual(["New"]);
    expect(result).toEqual({ registered: ["New"], failed: ["Bad"], readOnly: [], conflicts: [] });
  });

  it("passes the read-only flag through and reports it", async () => {
    const calls: Array<[string, boolean]> = [];
    const data = new Blob([new Uint8Array([1])]);
    const result = await registerPackagedFonts(
      [{ family: "Print", data, readOnly: true }, { family: "Edit", data, readOnly: false }],
      { compare: () => "absent", register: async (f, _d, o) => void calls.push([f, o.readOnly]) },
    );
    expect(calls).toEqual([["Print", true], ["Edit", false]]);
    expect(result.readOnly).toEqual(["Print"]);
  });

  it("registers and reports a packaged font whose name collides with a different local font", async () => {
    const replaced: boolean[] = [];
    const result = await registerPackagedFonts([{ family: "Brand", data: new Blob([new Uint8Array([9])]), readOnly: false }], {
      compare: () => "different",
      register: async (_f, _d, o) => void replaced.push(o.replacesExisting),
    });
    expect(replaced).toEqual([true]);
    expect(result.conflicts).toEqual(["Brand"]);
  });
});

describe("user fonts without stored bytes", () => {
  it("are reported as unknown-license instead of system", async () => {
    const plan = await planProjectFonts(projectUsing(["Lost Brand", "Comic Sans MS"]), async () => null, {
      isUserFont: (family) => family === "Lost Brand",
    });
    const status = Object.fromEntries(plan.entries.map((e) => [e.family, e.status]));
    expect(status).toEqual({ "Lost Brand": "unknown-license", "Comic Sans MS": "system" });
    expect(plan.payloads.size).toBe(0);
  });
});
