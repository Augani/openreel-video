import { describe, it, expect } from "vitest";
import { deriveSourceExportMatch } from "./export-source-match";
import type { Project } from "@openreel/core";

interface ItemSpec {
  id?: string;
  name?: string;
  type?: string;
  isPlaceholder?: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
  codec?: string;
}

function makeProject(
  items: ItemSpec[],
  canvas: { width: number; height: number } = { width: 1920, height: 1080 },
): Project {
  return {
    settings: { width: canvas.width, height: canvas.height },
    mediaLibrary: {
      items: items.map((it, idx) => ({
        id: it.id ?? `m${idx}`,
        name: it.name ?? `clip${idx}.mp4`,
        type: it.type ?? "video",
        isPlaceholder: it.isPlaceholder ?? false,
        metadata: {
          width: it.width ?? 0,
          height: it.height ?? 0,
          frameRate: it.frameRate ?? 30,
          codec: it.codec ?? "h264",
        },
      })),
    },
  } as unknown as Project;
}

describe("deriveSourceExportMatch", () => {
  it("returns null for a missing project", () => {
    expect(deriveSourceExportMatch(null)).toBeNull();
    expect(deriveSourceExportMatch(undefined)).toBeNull();
  });

  it("returns null when there is no usable video", () => {
    expect(deriveSourceExportMatch(makeProject([{ type: "audio" }]))).toBeNull();
    expect(deriveSourceExportMatch(makeProject([{ type: "video", width: 0, height: 0 }]))).toBeNull();
    expect(
      deriveSourceExportMatch(makeProject([{ type: "video", width: 1920, height: 1080, isPlaceholder: true }])),
    ).toBeNull();
  });

  it("matches the first imported video's dimensions and name", () => {
    const match = deriveSourceExportMatch(
      makeProject([{ name: "phone.mp4", width: 1080, height: 2340, frameRate: 30 }], { width: 1080, height: 1920 }),
    );
    expect(match).not.toBeNull();
    expect(match!.width).toBe(1080);
    expect(match!.height).toBe(2340);
    expect(match!.sourceName).toBe("phone.mp4");
  });

  it("prefers the video whose dimensions match the project canvas", () => {
    const match = deriveSourceExportMatch(
      makeProject(
        [
          { name: "broll.mp4", width: 1280, height: 720 },
          { name: "main.mp4", width: 3840, height: 2160 },
        ],
        { width: 3840, height: 2160 },
      ),
    );
    expect(match!.sourceName).toBe("main.mp4");
    expect(match!.width).toBe(3840);
    expect(match!.height).toBe(2160);
  });

  it("snaps non-integer frame rates to the nearest standard rate", () => {
    expect(deriveSourceExportMatch(makeProject([{ width: 1920, height: 1080, frameRate: 29.97 }]))!.frameRate).toBe(30);
    expect(deriveSourceExportMatch(makeProject([{ width: 1920, height: 1080, frameRate: 23.976 }]))!.frameRate).toBe(24);
    expect(deriveSourceExportMatch(makeProject([{ width: 1920, height: 1080, frameRate: 59.94 }]))!.frameRate).toBe(60);
  });

  it("produces a bitrate within sane bounds", () => {
    const small = deriveSourceExportMatch(makeProject([{ width: 320, height: 240, frameRate: 30 }]))!;
    const big = deriveSourceExportMatch(makeProject([{ width: 7680, height: 4320, frameRate: 60 }]))!;
    expect(small.bitrate).toBeGreaterThanOrEqual(2500);
    expect(big.bitrate).toBeLessThanOrEqual(60000);
  });
});
