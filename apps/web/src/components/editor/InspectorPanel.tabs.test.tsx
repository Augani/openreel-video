import "../../test/install-local-storage-mock";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { InspectorPanel } from "./InspectorPanel";

const clipId = "clip-vid";
const trackId = "track-vid";

function seedClip(opts: {
  mediaId: string;
  trackType: "video" | "audio" | "image";
}): Project {
  const project = createEmptyProject("Inspector Sections Test");
  const mediaType = opts.trackType;
  const seeded: Project = {
    ...project,
    mediaLibrary: {
      items: [
        {
          id: opts.mediaId,
          name: opts.mediaId,
          type: mediaType,
          fileHandle: null,
          blob: null,
          metadata: {
            duration: 10,
            width: mediaType === "audio" ? 0 : 1920,
            height: mediaType === "audio" ? 0 : 1080,
            frameRate: mediaType === "audio" ? 0 : 30,
            codec: mediaType === "audio" ? "aac" : "h264",
            sampleRate: mediaType === "image" ? 0 : 48_000,
            channels: mediaType === "image" ? 0 : 2,
            fileSize: 1,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        {
          id: trackId,
          type: opts.trackType,
          name: "Track",
          clips: [
            {
              id: clipId,
              mediaId: opts.mediaId,
              trackId,
              startTime: 0,
              duration: 10,
              inPoint: 0,
              outPoint: 10,
              effects: [],
              audioEffects: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
  useProjectStore.setState({ project: seeded });
  useUIStore.getState().select({ type: "clip", id: clipId, trackId });
  return seeded;
}

describe("InspectorPanel (no tabs, collapsible sections by clip type)", () => {
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ project: createEmptyProject("Reset") });
  });

  it("renders collapsible sections, not a tab bar", () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = render(<InspectorPanel />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });

  it("the Transform section is a collapsible with a toggle header", () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = render(<InspectorPanel />);
    const transformSection = container.querySelector<HTMLDivElement>(
      '[data-section-id="transform"]',
    );
    expect(transformSection).not.toBeNull();
    expect(transformSection?.querySelector("button")).not.toBeNull();
    expect(transformSection?.textContent).toContain("Transform");
  });

  it("a video clip renders the Transform section", () => {
    seedClip({ mediaId: "media-vid", trackType: "video" });
    const { container } = render(<InspectorPanel />);
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });

  it("an audio clip does NOT render the Transform section", () => {
    seedClip({ mediaId: "media-audio", trackType: "audio" });
    const { container } = render(<InspectorPanel />);
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).toBeNull();
  });

  it("shows per-clip volume and fade controls for audio media", () => {
    seedClip({ mediaId: "media-audio", trackType: "audio" });
    const { container } = render(<InspectorPanel />);

    expect(container.querySelector('[data-section-id="clip-audio"]')).not.toBeNull();
    expect(screen.getByText("Volume")).toBeTruthy();
    expect(screen.getByText("Fade in")).toBeTruthy();
    expect(screen.getByText("Fade out")).toBeTruthy();
    expect(container.querySelector('[data-section-id="auto-captions"]')).not.toBeNull();
    expect(container.querySelector('[data-section-id="editable-captions"]')).not.toBeNull();
  });

  it("an image clip renders the Transform section", () => {
    seedClip({ mediaId: "media-img", trackType: "image" });
    const { container } = render(<InspectorPanel />);
    expect(
      container.querySelector('[data-section-id="transform"]'),
    ).not.toBeNull();
  });
});
