import { vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" } }));

import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { developRawStill, parseSipsSize } from "../src/main/ipc/media";
import { deflateSync } from "node:zlib";

/**
 * Proprietary camera RAW on macOS goes through ImageIO (`sips`). On other platforms the handler must refuse with
 * the convert-to-DNG advice.
 */

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((p) => fs.rm(p, { force: true })));
});

const onMac = process.platform === "darwin" && existsSync("/usr/bin/sips");

describe("parseSipsSize", () => {
  it("reads the dimensions from sips output", () => {
    expect(parseSipsSize("/tmp/a.png\n  pixelWidth: 6000\n  pixelHeight: 4000\n")).toEqual({ width: 6000, height: 4000 });
    expect(parseSipsSize("nothing useful")).toBeNull();
  });
});

describe("developRawStill", () => {
  it.skipIf(onMac)("refuses off macOS and says to convert to DNG", async () => {
    await expect(developRawStill({ srcPath: "/x/IMG.CR3" })).rejects.toThrow(/Convert it to DNG/);
  });

  it.skipIf(!onMac)("converts an image file through sips into a PNG of the right size (handler plumbing)", async () => {
    // No camera RAW file is available in CI, and ImageIO rejects the synthetic DNG the unit tests use (it wants a
    // camera-profiled file), so the handler is driven with a plain 40 x 24 PNG: argument passing, output path,
    // PNG signature and size parsing are real; the RAW decode inside ImageIO is not covered here.
    const src = path.join(tmpdir(), `openreel-raw-${Date.now()}.png`);
    created.push(src);
    await fs.writeFile(src, solidPng(40, 24));
    const result = await developRawStill({ srcPath: src });
    created.push(result.outPath);
    expect(result.width).toBe(40);
    expect(result.height).toBe(24);
    const png = await fs.readFile(result.outPath);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it.skipIf(!onMac)("refuses relative paths and option-like names instead of passing them to sips", async () => {
    await expect(developRawStill({ srcPath: "-h" })).rejects.toThrow(/absolute/);
    await expect(developRawStill({ srcPath: "IMG_0001.CR3" })).rejects.toThrow(/absolute/);
    await expect(developRawStill({ srcPath: "/tmp/a\0.cr3" })).rejects.toThrow(/absolute/);
  });

  it.skipIf(!onMac)("fails clearly when ImageIO cannot read the file", async () => {
    const src = path.join(tmpdir(), `openreel-raw-bad-${Date.now()}.cr3`);
    created.push(src);
    await fs.writeFile(src, Buffer.from("not a raw file"));
    await expect(developRawStill({ srcPath: src })).rejects.toThrow();
  });
});

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** A solid grey RGB PNG, built by hand so the test needs no image library. */
function solidPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 128);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
