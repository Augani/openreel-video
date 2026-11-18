import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, deflateSync } from "node:zlib";
import {
  classifyFsType,
  fontMimeType,
  defaultBrotliDecoder,
  extractWoff2Os2Table,
  setBrotliDecoder,
  setBrotliWasmLoader,
  brotliDecodeBounded,
  type BrotliDecoder,
  type BrotliWasmModule,
  planProjectFonts,
  readFontEmbeddingPermission,
  registerPackagedFonts,
} from "./font-embedding";
import { createEmptyProject } from "../stores/project/project-helpers";
import { makeOs2Table, makeSfnt, makeWoff, makeWoff2, makeWoff2FromTables } from "./font-fixtures";

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

  it("reports unknown for non-font data and truncated WOFF2", async () => {
    expect((await readFontEmbeddingPermission(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).permission).toBe("unknown");
    const woff2 = new Uint8Array(48);
    new DataView(woff2.buffer).setUint32(0, 0x774f4632);
    expect((await readFontEmbeddingPermission(woff2.buffer)).permission).toBe("unknown");
  });
});

const nodeBrotli: BrotliDecoder = async (data) => new Uint8Array(brotliDecompressSync(data));
const brotliCompress = (data: Uint8Array) => brotliCompressSync(data);

describe("WOFF2", () => {
  let previous: BrotliDecoder;
  beforeEach(() => {
    previous = setBrotliDecoder(nodeBrotli);
  });
  afterEach(() => {
    setBrotliDecoder(previous);
  });

  it.each([
    [0, "installable"],
    [8, "editable"],
    [4, "preview-print"],
    [2, "restricted"],
    [0x0200, "restricted"],
  ] as const)("reads fsType %i from a Brotli table stream past other tables", async (fsType, permission) => {
    expect(await readFontEmbeddingPermission(makeWoff2(fsType, brotliCompress))).toEqual({ fsType, permission });
  });

  it("locates a real OS/2 table in every bundled WOFF2 file, not just one that happens to read 0", async () => {
    // No fontTools is available here, so the check is structural: a wrong stream offset would
    // land in glyph or cmap bytes, so require the located bytes to be a self-consistent OS/2
    // table: version 0-5, usWeightClass a multiple of 100 in 100..900, achVendID (offset 58)
    // printable ASCII, usFirstCharIndex <= usLastCharIndex, only defined fsType bits set, and at
    // least the v0 length of 78 bytes. (Some catalogue fonts really ship fsType 4, so no fixed value.)
    const dir = resolve(import.meta.dirname, "../../public/fonts") + "/";
    const files = readdirSync(dir).filter((name) => name.endsWith(".woff2"));
    expect(files.length).toBeGreaterThan(0);
    const seen = new Set<number>();
    for (const name of files) {
      const bytes = readFileSync(`${dir}${name}`);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const table = await extractWoff2Os2Table(data);
      expect(table, name).not.toBeNull();
      expect(table!.byteLength, name).toBeGreaterThanOrEqual(78);
      const view = new DataView(table!.buffer, table!.byteOffset, table!.byteLength);
      expect(view.getUint16(0), `${name} OS/2 version`).toBeLessThanOrEqual(5);
      expect(view.getUint16(4) % 100, `${name} usWeightClass`).toBe(0);
      expect(view.getUint16(4), name).toBeGreaterThanOrEqual(100);
      expect(view.getUint16(4), name).toBeLessThanOrEqual(900);
      const fsType = view.getUint16(8);
      expect(fsType & ~0x030e, `${name} fsType ${fsType}`).toBe(0);
      for (let i = 58; i < 62; i++) {
        const ch = table![i];
        expect(ch === 0 || (ch >= 0x20 && ch <= 0x7e), `${name} achVendID[${i - 58}]=${ch}`).toBe(true);
      }
      expect(view.getUint16(64), `${name} first<=last char`).toBeLessThanOrEqual(view.getUint16(66));
      expect(await readFontEmbeddingPermission(data), name).toEqual({ fsType, permission: classifyFsType(fsType) });
      seen.add(fsType);
    }
    // The bundled set includes a font whose licence is not plain "installable" (Zilla Slab: 4).
    expect(seen.has(4)).toBe(true);
  });

  it("finds OS/2 after an arbitrary-tag table, transformed glyf/loca and multi-byte lengths", async () => {
    const filler = (n: number, v: number) => new Uint8Array(n).fill(v);
    const data = makeWoff2FromTables(
      [
        { tag: "head", index: 1, stored: filler(54, 1) },
        // Transformed glyf (version 0): 300 origLength (2-byte base128), shorter stored stream.
        { tag: "glyf", index: 10, version: 0, origLength: 300, stored: filler(210, 2) },
        // Transformed loca must be present with glyf; origLength 400, stored length 0 per the spec.
        { tag: "loca", index: 11, version: 0, origLength: 400, stored: new Uint8Array(0) },
        // Arbitrary-tag table (index 63) with a length needing three base128 bytes.
        { tag: "XYZW", index: 63, stored: filler(20000, 3) },
        { tag: "OS/2", index: 6, stored: makeOs2Table(0x0008) },
        { tag: "post", index: 7, stored: filler(32, 4) },
      ],
      brotliCompress,
    );
    const table = await extractWoff2Os2Table(data);
    expect(table).not.toBeNull();
    expect(Array.from(table!)).toEqual(Array.from(makeOs2Table(0x0008)));
    expect(await readFontEmbeddingPermission(data)).toEqual({ fsType: 8, permission: "editable" });
  });

  it("finds OS/2 declared as an arbitrary tag, and treats a font with no OS/2 as installable", async () => {
    const os2ByTag = makeWoff2FromTables(
      [
        { tag: "head", index: 1, stored: new Uint8Array(54) },
        { tag: "OS/2", index: 63, stored: makeOs2Table(2) },
      ],
      brotliCompress,
    );
    expect(await readFontEmbeddingPermission(os2ByTag)).toEqual({ fsType: 2, permission: "restricted" });
    const none = makeWoff2FromTables([{ tag: "head", index: 1, stored: new Uint8Array(54) }], brotliCompress);
    expect(await readFontEmbeddingPermission(none)).toEqual({ fsType: 0, permission: "installable" });
  });

  it("rejects a transformed OS/2 and a stream shorter than the directory claims", async () => {
    const transformed = makeWoff2FromTables(
      [{ tag: "OS/2", index: 6, version: 1, stored: makeOs2Table(0), origLength: 96 }],
      brotliCompress,
    );
    expect((await readFontEmbeddingPermission(transformed)).permission).toBe("unknown");
    const short = makeWoff2FromTables(
      [
        { tag: "head", index: 1, stored: new Uint8Array(54) },
        { tag: "OS/2", index: 6, stored: makeOs2Table(0) },
      ],
      brotliCompress,
    );
    setBrotliDecoder(async (bytes) => new Uint8Array(brotliDecompressSync(bytes)).subarray(0, 60));
    expect((await readFontEmbeddingPermission(short)).permission).toBe("unknown");
  });

  it("reports unknown when no Brotli decoder is available, and never embeds the font", async () => {
    setBrotliDecoder(async () => null);
    const data = makeWoff2(0, brotliCompress);
    expect((await readFontEmbeddingPermission(data)).permission).toBe("unknown");
    const plan = await planProjectFonts(projectUsing(["Brand Web"]), async () => data);
    expect(plan.entries[0].status).toBe("unknown-license");
    expect(plan.payloads.size).toBe(0);
  });

  it("embeds permitted WOFF2 bytes unchanged and excludes restricted ones", async () => {
    const files: Record<string, ArrayBuffer> = {
      "Web Open": makeWoff2(0, brotliCompress),
      "Web Print": makeWoff2(4, brotliCompress),
      "Web Locked": makeWoff2(2, brotliCompress),
    };
    const plan = await planProjectFonts(projectUsing(Object.keys(files)), async (family) => files[family] ?? null);
    const status = Object.fromEntries(plan.entries.map((e) => [e.family, e.status]));
    expect(status).toEqual({ "Web Open": "embedded", "Web Print": "embedded-readonly", "Web Locked": "restricted" });
    expect(plan.payloads.get("Web Open")).toBe(files["Web Open"]);
    expect(plan.payloads.has("Web Locked")).toBe(false);
  });

  it("labels embedded font files with their real MIME type", () => {
    expect(fontMimeType(makeWoff2(0, brotliCompress))).toBe("font/woff2");
    expect(fontMimeType(makeWoff(0, false, deflateSync))).toBe("font/woff");
    expect(fontMimeType(makeSfnt(0, "otf"))).toBe("font/otf");
    expect(fontMimeType(makeSfnt(0, "ttf"))).toBe("font/ttf");
  });
});

function brotliStreamSupported(): boolean {
  try {
    new DecompressionStream("brotli" as ConstructorParameters<typeof DecompressionStream>[0]);
    return true;
  } catch {
    return false;
  }
}

describe("default Brotli decoder (production path, no injected decoder)", () => {
  const sample = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  beforeEach(() => {
    setBrotliDecoder(null);
    setBrotliWasmLoader(null);
  });

  afterAll(() => setBrotliWasmLoader(null));

  async function loadWasmFromDisk(): Promise<BrotliWasmModule> {
    const pkg = dirname(createRequire(import.meta.url).resolve("brotli-dec-wasm/web"));
    const mod = await import("brotli-dec-wasm/web");
    mod.initSync({ module: readFileSync(resolve(pkg, "brotli_dec_wasm_bg.wasm")) });
    return mod as unknown as BrotliWasmModule;
  }

  it.skipIf(!brotliStreamSupported())("decodes through DecompressionStream('brotli') and reads a real font's licence", async () => {
    expect(Array.from((await defaultBrotliDecoder(brotliCompressSync(sample)))!)).toEqual(Array.from(sample));
    const dir = resolve(import.meta.dirname, "../../public/fonts") + "/";
    const name = readdirSync(dir).find((n) => n.endsWith(".woff2"))!;
    const bytes = readFileSync(`${dir}${name}`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(await readFontEmbeddingPermission(data)).toEqual({ fsType: 0, permission: "installable" });
  });

  it("returns null (-> unknown licence, not embedded) when no decoder at all is available", async () => {
    setBrotliWasmLoader(async () => Promise.reject(new Error("wasm blocked")));
    vi.stubGlobal("DecompressionStream", class {
      constructor() {
        throw new TypeError("Unsupported compression format: 'brotli'");
      }
    });
    expect(await defaultBrotliDecoder(brotliCompressSync(sample))).toBeNull();
    const plan = await planProjectFonts(projectUsing(["No Brotli"]), async () => makeWoff2(0, brotliCompress));
    expect(plan.entries[0].status).toBe("unknown-license");
    expect(plan.payloads.size).toBe(0);
  });

  it("falls back to the desktop shell's Node-zlib bridge when DecompressionStream lacks brotli", async () => {
    vi.stubGlobal("DecompressionStream", class {
      constructor() {
        throw new TypeError("Unsupported compression format: 'brotli'");
      }
    });
    const calls: number[] = [];
    vi.stubGlobal("window", {
      openreel: {
        fonts: {
          brotliDecompress: async (data: Uint8Array) => {
            calls.push(data.byteLength);
            return new Uint8Array(brotliDecompressSync(data));
          },
        },
      },
    });
    const font = makeWoff2(2, brotliCompress);
    expect(await readFontEmbeddingPermission(font)).toEqual({ fsType: 2, permission: "restricted" });
    expect(calls.length).toBe(1);
    const open = makeWoff2(0, brotliCompress);
    const plan = await planProjectFonts(projectUsing(["Desktop Web"]), async () => open);
    expect(plan.entries[0].status).toBe("embedded");
    expect(plan.payloads.get("Desktop Web")).toBe(open);
  });

  it("treats a failing desktop bridge as no decoder", async () => {
    setBrotliWasmLoader(async () => Promise.reject(new Error("wasm blocked")));
    vi.stubGlobal("DecompressionStream", undefined);
    vi.stubGlobal("window", { openreel: { fonts: { brotliDecompress: async () => Promise.reject(new Error("ipc")) } } });
    expect(await defaultBrotliDecoder(brotliCompressSync(sample))).toBeNull();
  });

  it("falls back to the bundled wasm decoder in a browser without native Brotli or the desktop bridge", async () => {
    setBrotliWasmLoader(loadWasmFromDisk);
    vi.stubGlobal("DecompressionStream", undefined);
    expect(Array.from((await defaultBrotliDecoder(brotliCompressSync(sample)))!)).toEqual(Array.from(sample));
    const restricted = makeWoff2(2, brotliCompress);
    expect(await readFontEmbeddingPermission(restricted)).toEqual({ fsType: 2, permission: "restricted" });
    const open = makeWoff2(0, brotliCompress);
    const plan = await planProjectFonts(projectUsing(["Browser Web"]), async () => open);
    expect(plan.entries[0].status).toBe("embedded");
    expect(plan.payloads.get("Browser Web")).toBe(open);
    const dir = resolve(import.meta.dirname, "../../public/fonts") + "/";
    const name = readdirSync(dir).find((n) => n.endsWith(".woff2"))!;
    const bytes = readFileSync(`${dir}${name}`);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(await readFontEmbeddingPermission(data)).toEqual({ fsType: 0, permission: "installable" });
  });

  it("wasm decoder streams large output, and refuses output over the cap or truncated input", async () => {
    const wasm = await loadWasmFromDisk();
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) % 251);
    const packed = new Uint8Array(brotliCompressSync(big));
    expect(brotliDecodeBounded(wasm, packed)?.byteLength).toBe(big.byteLength);
    expect(brotliDecodeBounded(wasm, packed, 1024 * 1024)).toBeNull();
    expect(brotliDecodeBounded(wasm, packed.subarray(0, packed.byteLength >> 1))).toBeNull();
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
