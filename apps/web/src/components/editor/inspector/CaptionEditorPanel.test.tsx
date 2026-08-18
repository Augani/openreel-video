import "../../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project, TextClip } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { CaptionEditorPanel } from "./CaptionEditorPanel";

const TRACK_ID = "caption-track";

function caption(): TextClip {
  return {
    id: "caption-long",
    trackId: TRACK_ID,
    startTime: 10,
    duration: 7,
    text: "one two three four five six seven",
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
    metadata: { captionSource: "srt" },
  };
}

function project(textClip: TextClip): Project {
  const empty = createEmptyProject("Single-line captions");
  return {
    ...empty,
    textClips: [textClip],
    timeline: {
      ...empty.timeline,
      duration: 20,
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

describe("CaptionEditorPanel", () => {
  beforeEach(() => {
    const textClip = caption();
    useEngineStore.getState().getTitleEngine()?.clear();
    useEngineStore.getState().getTitleEngine()?.loadTextClips([textClip]);
    useProjectStore.setState({ hasOpenProject: true, project: project(textClip) });
  });

  afterEach(() => {
    cleanup();
    useEngineStore.getState().getTitleEngine()?.clear();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("Reset"),
    });
  });

  it("turns one long caption into sequential single-line clips", async () => {
    render(
      <CaptionEditorPanel
        maxWordsPerLine={5}
        onMaxWordsPerLineChange={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Make all 1 single-line" }),
    );

    await waitFor(() => {
      const clips = useEngineStore
        .getState()
        .getTitleEngine()
        ?.getAllTextClips()
        .sort((left, right) => left.startTime - right.startTime);
      expect(clips?.map((clip) => clip.text)).toEqual([
        "one two three four five",
        "six seven",
      ]);
      expect(clips?.map((clip) => [clip.startTime, clip.duration])).toEqual([
        [10, 5],
        [15, 2],
      ]);
      expect(clips?.every((clip) => !clip.text.includes("\n"))).toBe(true);
    });
  });
});
