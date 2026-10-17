import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob, File as NodeFile, Buffer } from "node:buffer";
import { copyMediaBlobInChunks, needsStableMediaCopy } from "./stable-media-blob";

beforeEach(() => { vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("stable media persistence", () => {
  it("detaches a file slice in bounded chunks while preserving exact bytes and type", async () => {
    const data = new Uint8Array(2 * 1024 * 1024 + 37);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const file = new Blob(["package header", data, "trailer"]);
    const slice = file.slice(14, 14 + data.length, "video/mp4");
    const wholeRead = vi.spyOn(slice, "arrayBuffer").mockRejectedValue(new Error("Do not buffer the whole original"));
    const readChunk = vi.spyOn(slice, "slice");
    const stable = await copyMediaBlobInChunks(slice);
    expect(Buffer.from(await stable.arrayBuffer()).equals(Buffer.from(data))).toBe(true);
    expect(stable.type).toBe("video/mp4");
    expect(readChunk).toHaveBeenCalledTimes(3);
    for (const [start, end] of readChunk.mock.calls) expect(end! - start!).toBeLessThanOrEqual(1024 * 1024);
    expect(wholeRead).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent persisted slice instead of saving corrupt bytes", async () => {
    const blob = new Blob(["media"]);
    vi.spyOn(blob, "slice").mockReturnValue(new Blob(["package header and media"]));
    await expect(copyMediaBlobInChunks(blob)).rejects.toThrow("Reopen the original project backup");
  });

  it("copies WebKit Blob slices while leaving complete Files and other browsers untouched", () => {
    const blob = new Blob(["media"]);
    vi.stubGlobal("navigator", { userAgent: "AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15" });
    expect(needsStableMediaCopy(blob)).toBe(true);
    expect(needsStableMediaCopy(new File([blob], "media.mp4"))).toBe(false);
    vi.stubGlobal("navigator", { userAgent: "AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36" });
    expect(needsStableMediaCopy(blob)).toBe(false);
    vi.stubGlobal("navigator", { userAgent: "Gecko/20100101 Firefox/157.0" });
    expect(needsStableMediaCopy(blob)).toBe(false);
  });
});
