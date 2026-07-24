import { describe, it, expect } from "vitest";
import { blenderRelativePath } from "../src/main/sidecar/blender-path";

describe("blenderRelativePath", () => {
  it("maps darwin slots to the Blender app executable", () => {
    expect(blenderRelativePath("darwin", "arm64")).toBe(
      "blender/darwin-arm64/Blender.app/Contents/MacOS/Blender",
    );
  });

  it("adds .exe on win32", () => {
    expect(blenderRelativePath("win32", "x64")).toBe("blender/win32-x64/blender.exe");
  });

  it("uses a plain blender executable on linux", () => {
    expect(blenderRelativePath("linux", "x64")).toBe("blender/linux-x64/blender");
  });
});
