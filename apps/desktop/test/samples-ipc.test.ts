import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false }, ipcMain: { handle: vi.fn(), on: vi.fn() } }));

import { getSample, listSamples } from "../src/main/ipc/samples";

const shipped = path.resolve(__dirname, "../resources/samples");
let tmp = "";
let outside = "";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-samples-"));
  fs.writeFileSync(path.join(tmp, "a.mp4"), Buffer.from([1, 2, 3, 4]));
  fs.writeFileSync(path.join(tmp, "..-secret.txt"), "nope");
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-outside-"));
  fs.writeFileSync(path.join(outside, "secret.mp4"), "nope");
  fs.symlinkSync(path.join(outside, "secret.mp4"), path.join(tmp, "link.mp4"));
  fs.writeFileSync(
    path.join(tmp, "manifest.json"),
    JSON.stringify({
      version: 1,
      clips: [
        { id: "a", name: "A", kind: "video", file: "a.mp4", mimeType: "video/mp4", durationSec: 1, sizeBytes: 4, license: "CC0" },
        { id: "link", name: "Link", kind: "video", file: "link.mp4", mimeType: "video/mp4", durationSec: 1, sizeBytes: 4, license: "CC0" },
        { id: "ghost", name: "Ghost", kind: "video", file: "missing.mp4", mimeType: "video/mp4", durationSec: 1, sizeBytes: 4, license: "CC0" },
        { id: "escape", name: "Escape", kind: "video", file: "../etc/passwd", mimeType: "video/mp4", durationSec: 1, sizeBytes: 4, license: "CC0" },
      ],
    }),
  );
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("samples ipc", () => {
  it("lists only entries that exist inside the samples folder", () => {
    expect(listSamples(tmp).map((c) => c.id)).toEqual(["a"]);
  });

  it("serves the bytes as an ArrayBuffer for a known id and null otherwise", async () => {
    const data = await getSample("a", tmp);
    expect(data?.mimeType).toBe("video/mp4");
    expect(Array.from(new Uint8Array(data!.bytes))).toEqual([1, 2, 3, 4]);
    expect(await getSample("nope", tmp)).toBeNull();
    expect(await getSample("escape", tmp)).toBeNull();
    expect(await getSample("../a", tmp)).toBeNull();
  });

  it("returns an empty list for a missing or corrupt manifest", () => {
    expect(listSamples(path.join(tmp, "nowhere"))).toEqual([]);
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-samples-bad-"));
    fs.writeFileSync(path.join(bad, "manifest.json"), "{not json");
    expect(listSamples(bad)).toEqual([]);
    fs.rmSync(bad, { recursive: true, force: true });
  });

  it("the shipped pack is complete, small and matches its manifest", () => {
    const clips = listSamples(shipped);
    expect(clips.filter((c) => c.kind === "video")).toHaveLength(3);
    expect(clips.filter((c) => c.kind === "audio")).toHaveLength(1);
    for (const clip of clips) {
      expect(clip.license).toMatch(/CC0/);
      expect(clip.durationSec).toBeGreaterThan(1);
    }
    const total = clips.reduce((sum, c) => sum + c.sizeBytes, 0);
    expect(total).toBeLessThan(15 * 1024 * 1024);
  });
});
