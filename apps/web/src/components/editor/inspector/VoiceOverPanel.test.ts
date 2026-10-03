import { describe, expect, it } from "vitest";
import { selectVoiceOverMimeType } from "./VoiceOverPanel";

describe("selectVoiceOverMimeType", () => {
  it("prefers Opus WebM when available", () => {
    expect(selectVoiceOverMimeType((type) => type === "audio/webm;codecs=opus")).toEqual({
      mimeType: "audio/webm;codecs=opus",
      extension: "webm",
    });
  });

  it("falls back to MP4 audio for Safari", () => {
    expect(selectVoiceOverMimeType((type) => type === "audio/mp4")).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
  });
});
