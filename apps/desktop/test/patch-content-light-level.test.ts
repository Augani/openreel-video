import { afterAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { clampLightLevel, hasEmulationHazard, patchContentLightLevel, patchLightLevelBuffer } from "../src/main/sidecar/patch-content-light-level";

const declared = [0x90, 0x04, 0x03, 0xe8, 0x01, 0x90];
const files: string[] = [];
afterAll(async () => {
  await Promise.all(files.map((f) => fs.rm(f, { force: true })));
});

describe("measured MaxCLL / MaxFALL written into the file", () => {
  it("replaces the declared 1000,400 SEI payload in every place and keeps the size", () => {
    const data = Buffer.from([1, 2, 3, ...declared, 9, 9, 0x4e, 0x01, ...declared, 0x80]);
    const before = data.length;
    expect(patchLightLevelBuffer(data, { maxCll: 603, maxFall: 112 })).toBe(2);
    expect(data.length).toBe(before);
    expect([...data.subarray(5, 9)]).toEqual([0x02, 0x5b, 0x00, 0x70]);
    expect(data.readUInt16BE(data.indexOf(Buffer.from([0x90, 0x04])) + 2)).toBe(603);
  });

  it("patches an clli box and leaves unrelated bytes alone", () => {
    const clli = Buffer.concat([Buffer.from("clli"), Buffer.from([0x03, 0xe8, 0x01, 0x90])]);
    const other = Buffer.from([0x90, 0x04, 0x11, 0x22, 0x33, 0x44]);
    const data = Buffer.concat([other, clli]);
    expect(patchLightLevelBuffer(data, { maxCll: 4000, maxFall: 300 })).toBe(1);
    expect(data.subarray(0, 6)).toEqual(other);
    expect(data.readUInt16BE(data.indexOf("clli") + 4)).toBe(4000);
    expect(data.readUInt16BE(data.indexOf("clli") + 6)).toBe(300);
  });

  it("leaves the declared values when the new bytes would need emulation prevention", () => {
    const data = Buffer.from(declared);
    expect(hasEmulationHazard(Buffer.from([0x01, 0x00, 0x00, 0x01]))).toBe(true);
    expect(patchLightLevelBuffer(data, { maxCll: 256, maxFall: 1 })).toBe(0);
    expect([...data]).toEqual(declared);
  });

  it("clamps to the 16-bit SEI range", () => {
    expect(clampLightLevel({ maxCll: 99999, maxFall: -3 })).toEqual({ maxCll: 65535, maxFall: 0 });
    expect(clampLightLevel({ maxCll: NaN, maxFall: 400.4 })).toEqual({ maxCll: 0, maxFall: 400 });
  });

  it("patches across chunk boundaries in a large file", async () => {
    const file = path.join(tmpdir(), `openreel-cll-${Date.now()}.bin`);
    files.push(file);
    const size = 9 * 1024 * 1024;
    const data = Buffer.alloc(size, 0xaa);
    // One occurrence straddling the 4 MiB chunk boundary, one near the end.
    Buffer.from(declared).copy(data, 4 * 1024 * 1024 - 3);
    Buffer.from(declared).copy(data, size - 100);
    await fs.writeFile(file, data);
    const patched = await patchContentLightLevel(file, { maxCll: 700, maxFall: 150 });
    expect(patched).toBeGreaterThanOrEqual(2);
    const out = await fs.readFile(file);
    expect(out.length).toBe(size);
    expect(out.readUInt16BE(4 * 1024 * 1024 - 3 + 2)).toBe(700);
    expect(out.readUInt16BE(size - 100 + 4)).toBe(150);
  });
});
