import { describe, expect, it } from "vitest";
import { exportBody, exportProblem, imageJobItems, importFileName, referenceItems, videoJobItems } from "./library";

describe("library rows", () => {
  it("expands image jobs into one item per image", () => {
    const items = imageJobItems([{ id: "j1", title: "Knight", image_urls: [{ imageURL: "https://x/a.png" }, { imageURL: "https://x/b.png" }], created_at: "t" }]);
    expect(items.map((i) => [i.key, i.title, i.url])).toEqual([
      ["img:j1:0", "Knight (1)", "https://x/a.png"],
      ["img:j1:1", "Knight (2)", "https://x/b.png"],
    ]);
  });
  it("uses the prompt when there is no title, and skips videos without a file", () => {
    const items = videoJobItems([
      { request_id: "r1", prompt: "A falcon flies", video_url: "https://x/v.mp4", frame_urls: ["https://x/f0.jpg"] },
      { request_id: "r2", video_url: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "vid:r1", title: "A falcon flies", thumb: "https://x/f0.jpg" });
  });
  it("keeps only image and video references", () => {
    const items = referenceItems([
      { id: "a", kind: "image", path: "u/a.png", title: "" },
      { id: "b", kind: "audio", path: "u/b.mp3" },
      { id: "c", kind: "video", path: "u/c.mp4", title: "Clip" },
    ]);
    expect(items.map((i) => [i.key, i.kind, i.title, i.path])).toEqual([
      ["ref:a", "image", "Image", "u/a.png"],
      ["ref:c", "video", "Clip", "u/c.mp4"],
    ]);
  });
});

describe("importFileName", () => {
  it("takes the extension from the URL path, ignoring the query", () => {
    expect(importFileName({ title: "Knight", kind: "image" }, "https://x/u/a.webp?token=1", "image/webp")).toBe("Knight.webp");
  });
  it("falls back to the MIME type, and strips unsafe characters", () => {
    expect(importFileName({ title: 'A/B: "C"', kind: "video" }, "https://x/sign", "video/quicktime")).toBe("A B C.mov");
  });
});

describe("exportProblem", () => {
  const MB = 1024 * 1024;
  it("accepts MP4 and MOV within the limit", () => {
    expect(exportProblem({ size: 5 * MB, type: "video/mp4" }, "a.mp4", 100 * MB)).toBeNull();
    expect(exportProblem({ size: 5 * MB, type: "" }, "a.mov", 100 * MB)).toBeNull();
  });
  it("rejects other formats, empty and oversized files", () => {
    expect(exportProblem({ size: 5 * MB, type: "video/webm" }, "a.webm", 100 * MB)).toMatch(/MP4/);
    expect(exportProblem({ size: 0, type: "video/mp4" }, "a.mp4", 100 * MB)).toMatch(/empty/);
    expect(exportProblem({ size: 101 * MB, type: "video/mp4" }, "a.mp4", 100 * MB)).toMatch(/100 MB/);
  });
});

describe("exportBody", () => {
  it("gives an untyped browser export the video type the storage bucket accepts", () => {
    const mp4 = exportBody(new Blob([new Uint8Array(8)]), "New Project.mp4");
    expect(mp4.type).toBe("video/mp4");
    expect(mp4.size).toBe(8);
    expect(exportBody(new Blob([new Uint8Array(8)]), "clip.MOV").type).toBe("video/quicktime");
    expect(exportBody(new Blob([new Uint8Array(8)], { type: "video/quicktime" }), "clip").type).toBe("video/quicktime");
  });
  it("keeps an already typed blob as is", () => {
    const typed = new Blob([new Uint8Array(8)], { type: "video/mp4" });
    expect(exportBody(typed, "a.mp4")).toBe(typed);
  });
});
