import { describe, it, expect } from "vitest";
import { ffmpegRelativePath } from "../src/main/sidecar/ffmpeg-path";

describe("ffmpegRelativePath", () => {
  it("maps darwin/arm64 to the right subpath", () => {
    expect(ffmpegRelativePath("darwin", "arm64")).toBe("darwin-arm64/ffmpeg");
  });
  it("adds .exe on win32", () => {
    expect(ffmpegRelativePath("win32", "x64")).toBe("win32-x64/ffmpeg.exe");
  });
});
