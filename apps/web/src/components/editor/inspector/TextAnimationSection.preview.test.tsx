import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { TextAnimationSection } from "./TextAnimationSection";

const CLIP_ID = "animated-title";

function textClip(): TextClip {
  return {
    id: CLIP_ID,
    trackId: "title-track",
    startTime: 0,
    duration: 5,
    text: "OpenReel",
    style: {
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
  };
}

describe("TextAnimationSection previews", () => {
  beforeEach(() => {
    const clip = textClip();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([clip]);
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...createEmptyProject("Text animation previews"),
        textClips: [clip],
      },
    });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("previews every animation and applies the selected look", async () => {
    render(<TextAnimationSection clipId={CLIP_ID} />);

    expect(
      screen.getAllByTestId("text-animation-preset-preview"),
    ).toHaveLength(24);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and apply Rise" }),
    );

    await waitFor(() => {
      expect(
        useEngineStore.getState().getTitleEngine()?.getTextClip(CLIP_ID)
          ?.animation?.preset,
      ).toBe("rise");
    });
    expect(
      screen.getByRole("button", { name: "Preview and apply Rise" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
