import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Subtitle } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { TranscriptPanel } from "./TranscriptPanel";

const cues: Subtitle[] = [
  {
    id: "c1",
    text: "Hello there. Second one.",
    startTime: 0,
    endTime: 4,
    words: [
      { text: "Hello", startTime: 0, endTime: 0.5 },
      { text: "there.", startTime: 0.5, endTime: 1 },
      { text: "Second", startTime: 2, endTime: 2.5 },
      { text: "one.", startTime: 2.5, endTime: 3 },
    ],
  },
];

// jsdom has no PointerEvent, so dispatch the same event name as a MouseEvent.
const pointerDown = (el: Element) =>
  fireEvent(el, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));

const setSubtitles = (subtitles: Subtitle[]) => {
  const project = createEmptyProject("Transcript");
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...project, timeline: { ...project.timeline, subtitles } },
  });
};

describe("TranscriptPanel", () => {
  beforeEach(() => {
    setSubtitles(cues);
    useTimelineStore.setState({ playheadPosition: 0 });
  });
  afterEach(() => {
    cleanup();
    setSubtitles([]);
  });

  it("drops its word selection when the captions change underneath it", () => {
    render(<TranscriptPanel />);
    const word = screen.getByText("one.");
    pointerDown(word);
    expect(screen.getByRole("button", { name: "Delete selected transcript text" })).toBeEnabled();

    // e.g. undo of the import: the words the selection pointed at are gone.
    expect(() => act(() => setSubtitles([]))).not.toThrow();
    expect(screen.getByRole("button", { name: "Delete selected transcript text" })).toBeDisabled();
  });

  it("does not select different words after the captions are replaced", () => {
    render(<TranscriptPanel />);
    pointerDown(screen.getByText("Second"));
    act(() =>
      setSubtitles([{ id: "n", text: "Brand new", startTime: 0, endTime: 1 }]),
    );
    expect(screen.getByRole("button", { name: "Delete selected transcript text" })).toBeDisabled();
  });
});
