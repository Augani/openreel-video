import { describe, expect, it } from "vitest";
import { ZipWriter, crc32, readZipStore, safeZipName, zipStore } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("zip store writer", () => {
  it("computes the standard CRC-32 check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("round-trips several files byte for byte", async () => {
    const big = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 31 + 7) & 255);
    const zip = await zipStore([
      { name: "Project_Dialogue.wav", data: big },
      { name: "Project_Music.wav", data: bytes("RIFF....") },
      { name: "empty.bin", data: new Uint8Array(0) },
    ]);
    const files = readZipStore(zip);
    expect(files.map((f) => f.name)).toEqual(["Project_Dialogue.wav", "Project_Music.wav", "empty.bin"]);
    expect(files[0].data).toEqual(big);
    expect(Array.from(files[1].data)).toEqual(Array.from(bytes("RIFF....")));
    expect(files[2].size).toBe(0);
  });

  it("streams to a sink without holding the whole archive and reports bytes written", async () => {
    const chunks: Uint8Array[] = [];
    const writer = new ZipWriter((chunk) => void chunks.push(chunk));
    await writer.add({ name: "a.wav", data: bytes("hello") });
    await writer.finish();
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBe(writer.bytesWritten);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.byteLength;
    }
    expect(readZipStore(joined)[0].data).toEqual(bytes("hello"));
  });

  it("rejects duplicate names and sanitises unsafe ones", async () => {
    expect(safeZipName("../../etc/passwd")).toBe("etc/passwd");
    expect(safeZipName("C:\\x\\y.wav")).toBe("x/y.wav");
    expect(() => readZipStore(new Uint8Array(5))).toThrow(/Not a zip/);
    await expect(zipStore([{ name: "a", data: bytes("1") }, { name: "a", data: bytes("2") }])).rejects.toThrow(/Duplicate/);
  });

  it("detects corruption through the CRC", async () => {
    const zip = await zipStore([{ name: "a.wav", data: bytes("payload!") }]);
    const bad = zip.slice();
    bad[30 + "a.wav".length + 2] ^= 0xff;
    expect(() => readZipStore(bad)).toThrow(/CRC/);
  });
});
