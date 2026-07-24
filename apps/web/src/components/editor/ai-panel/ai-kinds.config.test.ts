import { describe, it, expect } from "vitest";
import {
  AI_KINDS,
  AI_KIND_GROUPS,
  kindsForClipType,
  kindMatchesClipType,
  isWebSupported,
  outputForKind,
  type ClipMediaType,
} from "./ai-kinds.config";
import { AI_CLOUD_JOB_KINDS } from "@openreel/core";

const kindByLabel = (label: string) => AI_KINDS.find((k) => k.label === label)!;

describe("ai-kinds output classification", () => {
  it("classifies the data-output kinds correctly", () => {
    expect(outputForKind(AI_CLOUD_JOB_KINDS.transcription)).toBe("subtitles");
    expect(outputForKind(AI_CLOUD_JOB_KINDS.autoCaptions)).toBe("subtitles");
    expect(outputForKind(AI_CLOUD_JOB_KINDS.sceneDetection)).toBe("scenes");
    expect(outputForKind(AI_CLOUD_JOB_KINDS.aiHighlight)).toBe("highlights");
    expect(outputForKind(AI_CLOUD_JOB_KINDS.objectTracking)).toBe("tracking");
    expect(outputForKind(AI_CLOUD_JOB_KINDS.upscale)).toBe("media");
  });

  it("hides kinds with no web consumer yet", () => {
    const hidden = ["Person Matte", "Stabilize", "Auto Reframe", "Face Analysis", "Remove Silence", "Translate"];
    for (const label of hidden) expect(isWebSupported(kindByLabel(label))).toBe(false);
  });

  it("keeps the wired data kinds web-supported", () => {
    const supported = ["Transcribe", "Auto Captions", "Scene Detection", "AI Highlights", "Object Tracking"];
    for (const label of supported) expect(isWebSupported(kindByLabel(label))).toBe(true);
  });

  it("marks the interactive editors", () => {
    expect(kindByLabel("Object Removal").interactive).toBe(true);
    expect(kindByLabel("Object Tracking").interactive).toBe(true);
  });
});

describe("ai-kinds.config", () => {
  it("covers all 25 job kinds exactly once", () => {
    const kinds = AI_KINDS.map((k) => k.kind).sort();
    const all = Object.values(AI_CLOUD_JOB_KINDS).sort();
    expect(kinds).toEqual(all);
  });
  it("only music_generation and translation are clip-optional", () => {
    const optional = AI_KINDS.filter((k) => !k.requiresClip).map((k) => k.kind).sort();
    expect(optional).toEqual(["music_generation", "translation"]);
  });
  it("every kind's group is a known group", () => {
    for (const k of AI_KINDS) expect(AI_KIND_GROUPS).toContain(k.group);
  });
  it("clip-optional kinds have no media relevance; clip-requiring kinds have at least one", () => {
    for (const k of AI_KINDS) {
      if (k.requiresClip) expect(k.media.length).toBeGreaterThan(0);
      else expect(k.media).toEqual([]);
    }
  });
});

describe("ai-kinds clip-type relevance", () => {
  const labelsFor = (clipType: ClipMediaType): string[] =>
    kindsForClipType(clipType).map((k) => k.label);

  it("never includes clip-free Generate kinds in a clip-scoped view", () => {
    for (const clipType of ["video", "image", "audio"] as const) {
      const kinds = kindsForClipType(clipType);
      expect(kinds.every((k) => k.requiresClip)).toBe(true);
      expect(kinds.some((k) => k.group === "Generate")).toBe(false);
      expect(kinds.every((k) => kindMatchesClipType(k, clipType))).toBe(true);
    }
  });

  it("image hides motion/temporal/video-only kinds but keeps stills tools", () => {
    const image = labelsFor("image");
    expect(kindsForClipType("image").some((k) => k.group === "Audio")).toBe(false);
    expect(image).not.toContain("Stabilize");
    expect(image).not.toContain("Auto Reframe");
    expect(image).not.toContain("Smooth (Interpolate)");
    expect(image).not.toContain("Person Matte");
    expect(image).not.toContain("Face Analysis");
    expect(image).toContain("Upscale");
    expect(image).toContain("Denoise");
    expect(image).toContain("Face Restore");
    expect(image).toContain("Color Match");
    expect(image).toContain("Photo Enhance");
    expect(image).toContain("Colorize");
    expect(image).toContain("Remove Background");
    expect(image).toContain("Object Removal");
    expect(image).toContain("Portrait Bokeh");
  });

  it("audio shows only audio-relevant kinds", () => {
    const audio = labelsFor("audio");
    expect(audio).toContain("Separate Audio");
    expect(audio).toContain("Enhance Voice");
    expect(audio).toContain("Transcribe");
    expect(audio).not.toContain("Upscale");
    expect(audio).not.toContain("Stabilize");
  });

  it("video shows motion + analyze + audio kinds but not image-only enhancers", () => {
    const video = labelsFor("video");
    expect(video).toContain("Smooth (Interpolate)");
    expect(video).toContain("Stabilize");
    expect(video).toContain("Person Matte");
    expect(video).toContain("Separate Audio");
    expect(video).toContain("Scene Detection");
    expect(video).not.toContain("Remove Background");
    expect(video).not.toContain("Upscale");
    expect(video).not.toContain("Denoise");
    expect(video).not.toContain("Face Restore");
    expect(video).not.toContain("Color Match");
  });

  it("kindMatchesClipType reflects the media array (upscale is image-only)", () => {
    const upscale = AI_KINDS.find((k) => k.label === "Upscale");
    expect(upscale).toBeDefined();
    expect(kindMatchesClipType(upscale!, "image")).toBe(true);
    expect(kindMatchesClipType(upscale!, "video")).toBe(false);
    expect(kindMatchesClipType(upscale!, "audio")).toBe(false);
  });

  it("worker-accurate filters: frame-output enhancers are image-only, AI Highlights is video-only", () => {
    for (const label of ["Upscale", "Denoise", "Face Restore", "Color Match"]) {
      const kind = AI_KINDS.find((k) => k.label === label);
      expect(kind, label).toBeDefined();
      expect(kind!.media).toEqual(["image"]);
    }
    const highlights = AI_KINDS.find((k) => k.label === "AI Highlights");
    expect(highlights!.media).toEqual(["video"]);
  });
});
