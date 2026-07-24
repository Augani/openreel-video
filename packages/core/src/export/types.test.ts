import { describe, it, expect } from "vitest";
import { DEFAULT_VIDEO_SETTINGS } from "./types";

describe("DEFAULT_VIDEO_SETTINGS", () => {
  it("defaults encodeMode to balanced", () => {
    expect(DEFAULT_VIDEO_SETTINGS.encodeMode).toBe("balanced");
  });
});
