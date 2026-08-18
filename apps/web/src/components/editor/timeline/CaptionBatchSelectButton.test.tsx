import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project, TextClip } from "@openreel/core";
import { useEngineStore } from "../../../stores/engine-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { CaptionBatchSelectButton } from "./CaptionBatchSelectButton";

const TRACK_ID = "caption-track";

function caption(id: string, startTime: number): TextClip {
  return {
    id,
    trackId: TRACK_ID,
    startTime,
    duration: 1,
    text: id,
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    transform: {
      position: { x: 0.5, y: 0.8 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    keyframes: [],
    metadata: { captionSource: "whisper" },
  };
}

function captionProject(): Project {
  const empty = createEmptyProject("Caption selection");
  return {
    ...empty,
    textClips: [],
    timeline: {
      ...empty.timeline,
      tracks: [
        {
          id: TRACK_ID,
          type: "text",
          name: "Captions",
          clips: [],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}

describe("CaptionBatchSelectButton", () => {
  beforeEach(() => {
    useEngineStore
      .getState()
      .getTitleEngine()
      ?.loadTextClips([caption("caption-a", 0), caption("caption-b", 2)]);
    useProjectStore.setState({ project: captionProject(), hasOpenProject: true });
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useUIStore.getState().clearSelection();
  });

  it("makes caption batch selection visible and selects every caption", () => {
    render(<CaptionBatchSelectButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Select all captions (2)" }),
    );

    expect(useUIStore.getState().selectedItems).toEqual([
      { id: "caption-a", trackId: TRACK_ID, type: "text-clip" },
      { id: "caption-b", trackId: TRACK_ID, type: "text-clip" },
    ]);
  });
});
