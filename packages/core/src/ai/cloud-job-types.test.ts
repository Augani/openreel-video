import { describe, it, expect } from "vitest";
import {
  AI_CLOUD_JOB_KINDS,
  isTerminalStatus,
  MEDIA_OPTIONAL_KINDS,
  artifactIsImage,
  artifactIsVideo,
  artifactIsAudio,
} from "./cloud-job-types";

describe("cloud-job-types", () => {
  it("uses snake_case wire values for kinds", () => {
    expect(AI_CLOUD_JOB_KINDS.aiHighlight).toBe("ai_highlight");
    expect(AI_CLOUD_JOB_KINDS.backgroundRemoval).toBe("background_removal");
    expect(AI_CLOUD_JOB_KINDS.upscale).toBe("upscale");
    expect(Object.keys(AI_CLOUD_JOB_KINDS).length).toBe(25);
  });
  it("marks completed/failed/cancelled terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("processing")).toBe(false);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("uploading")).toBe(false);
  });
  it("knows media-optional kinds", () => {
    expect(MEDIA_OPTIONAL_KINDS.has("music_generation")).toBe(true);
    expect(MEDIA_OPTIONAL_KINDS.has("translation")).toBe(true);
    expect(MEDIA_OPTIONAL_KINDS.has("upscale")).toBe(false);
  });
  it("classifies artifacts by type or extension", () => {
    expect(artifactIsImage({ relativePath: "out.png" })).toBe(true);
    expect(artifactIsVideo({ relativePath: "out.mp4" })).toBe(true);
    expect(artifactIsAudio({ relativePath: "out.wav" })).toBe(true);
    expect(artifactIsImage({ type: "image", relativePath: "x" })).toBe(true);
    expect(artifactIsVideo({ relativePath: "out.png" })).toBe(false);
  });
});
