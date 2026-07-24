import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { disposeTransitionBridge } from "../../../bridges/transition-bridge";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { EffectsPanel, TransitionsPanel } from "./EffectsTransitionsPanel";

describe("editor effect and transition catalogs", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    disposeTransitionBridge();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("offers directional transition variants with animated preview cards", () => {
    render(<TransitionsPanel />);

    expect(
      screen.getByRole("button", {
        name: /^Wipe Left\. Drag onto a clip edge/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^Slide Down\. Drag onto a clip edge/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Whip Pan")).toBeInTheDocument();
    expect(screen.getByText("Soft Wipe Left")).toBeInTheDocument();
    expect(screen.getByText("Push Down")).toBeInTheDocument();
    expect(screen.getByText("Punch Zoom")).toBeInTheDocument();
    expect(screen.getByText("Pixelate")).toBeInTheDocument();
    expect(screen.getByText("Glitch Cut")).toBeInTheDocument();
    expect(screen.getByText("Venetian Blinds")).toBeInTheDocument();
    expect(screen.getByText("Diamond Reveal")).toBeInTheDocument();
    expect(screen.getByText("Spin Clockwise")).toBeInTheDocument();
    expect(screen.getByText("Flip Vertical")).toBeInTheDocument();
    expect(screen.getByText("Split Horizontal")).toBeInTheDocument();
    expect(screen.getByText("Flash Cut")).toBeInTheDocument();
    expect(screen.getByText("Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Red Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Cool Light Leak")).toBeInTheDocument();
    expect(screen.getByText("Mosaic Reveal")).toBeInTheDocument();
    expect(screen.getByText("Ripple")).toBeInTheDocument();
    expect(screen.getByText("Page Turn Left")).toBeInTheDocument();
    expect(screen.getByText("Page Turn Right")).toBeInTheDocument();
    expect(screen.getByText("Color Split")).toBeInTheDocument();
    for (const category of ["Dissolves", "Wipes", "Movement", "Stylized"]) {
      expect(screen.getByText(category)).toBeInTheDocument();
    }
  });

  it("filters the expanded transition library by production category", () => {
    render(<TransitionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stylized 13" }));

    expect(screen.getByRole("button", { name: "Stylized 13" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Film Burn")).toBeInTheDocument();
    expect(screen.getByText("Punch Zoom")).toBeInTheDocument();
    expect(screen.queryByText("Wipe Left")).not.toBeInTheDocument();
    expect(screen.queryByText("Push Down")).not.toBeInTheDocument();
  });

  it("includes tonal balance and chroma key in the effect browser", () => {
    render(<EffectsPanel />);

    expect(screen.getByText("Tonal Balance")).toBeInTheDocument();
    expect(screen.getByText("Chroma Key")).toBeInTheDocument();
    expect(screen.getByText("Cinematic Punch")).toBeInTheDocument();
    expect(screen.getByText("Golden Hour")).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByText("Dream Bloom")).toBeInTheDocument();
    expect(screen.getByText("Retro Grain")).toBeInTheDocument();
    expect(screen.getByText("RGB Split")).toBeInTheDocument();
    expect(screen.getByText("VHS")).toBeInTheDocument();
    expect(screen.getByText("Posterize")).toBeInTheDocument();
    expect(screen.getByText("Duotone")).toBeInTheDocument();
    expect(screen.getByText("Prism Split")).toBeInTheDocument();
    expect(screen.getByText("Fisheye")).toBeInTheDocument();
    expect(screen.getByText("Wave Warp")).toBeInTheDocument();
    expect(screen.getByText("Scanlines")).toBeInTheDocument();
    expect(screen.getByText("Edge Glow")).toBeInTheDocument();
    const preview = screen
      .getByRole("button", {
        name: /^Golden Hour\. Drag onto a clip to apply/i,
      })
      .querySelector('[data-effect-preview="golden-hour"]');
    expect(preview).toHaveAttribute("data-preview-progress", "0.72");
  });

  it("filters visual effects by category without losing previews", () => {
    render(<EffectsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Stylize 10" }));

    expect(screen.getByRole("button", { name: "Stylize 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Dream Bloom")).toBeInTheDocument();
    expect(screen.getByText("RGB Split")).toBeInTheDocument();
    expect(screen.queryByText("Brightness")).not.toBeInTheDocument();
    expect(screen.queryByText("Golden Hour")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-effect-preview]")).toHaveLength(10);
  });

  it("applies curated effect parameters to the selected overlay", async () => {
    useProjectStore.getState().createNewProject("Curated effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Golden title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^Golden Hour\. Drag onto a clip to apply/i,
      }),
    );
    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^VHS\. Drag onto a clip to apply/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({
          type: "temperature",
          params: { value: 35 },
        }),
        expect.objectContaining({
          type: "shader",
          params: {
            shaderId: "vhs",
            intensity: 0.75,
            scanlines: 0.4,
            jitter: 0.45,
          },
        }),
      ]);
    });
  });

  it("double-clicks an effect onto a selected text overlay", async () => {
    useProjectStore.getState().createNewProject("Text effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Effect title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^Brightness\. Drag onto a clip to apply/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({ type: "brightness", enabled: true }),
      ]);
    });
  });

  it("double-clicks a preview variant onto the selected cut with its params", async () => {
    const first = clip("transition-a", 0);
    const second = clip("transition-b", 3);
    const project = createEmptyProject("Transition application");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          duration: 6,
          tracks: [
            {
              id: "transition-track",
              type: "video",
              name: "Video",
              clips: [first, second],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.getState().selectMultiple([
      { type: "clip", id: first.id, trackId: first.trackId },
      { type: "clip", id: second.id, trackId: second.trackId },
    ]);
    render(<TransitionsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: /Page Turn Right\. Drag onto/i }),
    );

    await waitFor(() => {
      const transition =
        useProjectStore.getState().project.timeline.tracks[0]?.transitions[0];
      expect(transition).toMatchObject({
        clipAId: first.id,
        clipBId: second.id,
        type: "pageTurn",
        params: { direction: "right", shadow: 0.55 },
      });
    });
  });
});

function clip(id: string, startTime: number): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: "transition-track",
    startTime,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
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
  };
}
