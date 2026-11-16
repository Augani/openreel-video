import { describe, it, expect } from "vitest";
import { parseProgressBlock } from "../src/main/sidecar/export-job";

describe("parseProgressBlock", () => {
  it("extracts frame number from ffmpeg -progress output", () => {
    const block = "frame=42\nfps=30\nbitrate=...\nprogress=continue\n";
    expect(parseProgressBlock(block)?.frame).toBe(42);
  });
  it("detects end", () => {
    expect(parseProgressBlock("frame=100\nprogress=end\n")?.done).toBe(true);
  });
  it("returns null when no frame field present", () => {
    expect(parseProgressBlock("fps=30\nbitrate=...\n")).toBeNull();
  });
  it("returns the LATEST frame from a multi-block buffer (progress must advance, not freeze)", () => {
    const buf = "frame=10\nprogress=continue\nframe=20\nprogress=continue\nframe=37\nprogress=continue\n";
    expect(parseProgressBlock(buf)?.frame).toBe(37);
  });
});
