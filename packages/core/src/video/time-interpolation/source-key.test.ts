import { describe, expect, it } from "vitest";
import { interpolationSourceKey } from "./source-key";

describe("interpolationSourceKey", () => {
  it("is stable for the same file and size", () => {
    const blob = new Blob(["a"]);
    expect(interpolationSourceKey("m1", blob, 1920, 1080)).toBe(interpolationSourceKey("m1", blob, 1920, 1080));
  });
  it("changes when the file is replaced under the same media id", () => {
    expect(interpolationSourceKey("m1", new Blob(["a"]), 1920, 1080)).not.toBe(interpolationSourceKey("m1", new Blob(["a"]), 1920, 1080));
  });
  it("changes with the project size and the media id", () => {
    const blob = new Blob(["a"]);
    expect(interpolationSourceKey("m1", blob, 1920, 1080)).not.toBe(interpolationSourceKey("m1", blob, 3840, 2160));
    expect(interpolationSourceKey("m1", blob, 1920, 1080)).not.toBe(interpolationSourceKey("m2", blob, 1920, 1080));
  });
});
