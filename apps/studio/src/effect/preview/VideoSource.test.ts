import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { VideoSource, type SampleClip } from "./VideoSource";

beforeAll(() => {
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => `blob:mock/${(blob as File).name ?? "file"}`,
    revokeObjectURL: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const sample: SampleClip = {
  id: "portrait-closeup-01",
  label: "Portrait close-up",
  aspect: "9:16",
  durationSec: 10,
  url: "/samples/portrait-closeup-01.mp4",
  tests: ["face"],
};

describe("VideoSource", () => {
  it("constructs from a SampleClip and exposes the url", () => {
    const src = VideoSource.fromSampleClip(sample);
    expect(src.url).toBe("/samples/portrait-closeup-01.mp4");
    expect(src.label).toBe("Portrait close-up");
    expect(src.userUploaded).toBe(false);
  });

  it("constructs from a File and exposes an object URL", () => {
    const file = new File([new Uint8Array([0])], "myclip.mp4", { type: "video/mp4" });
    const src = VideoSource.fromFile(file);
    expect(src.url.startsWith("blob:")).toBe(true);
    expect(src.userUploaded).toBe(true);
    src.dispose();
  });

  it("rejects files larger than 200MB", () => {
    const file = new File([new Uint8Array(0)], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 + 1 });
    expect(() => VideoSource.fromFile(file)).toThrow(/200MB/);
  });

  it("rejects non-video MIME types", () => {
    const file = new File([new Uint8Array(1)], "doc.pdf", { type: "application/pdf" });
    expect(() => VideoSource.fromFile(file)).toThrow(/video/);
  });
});
