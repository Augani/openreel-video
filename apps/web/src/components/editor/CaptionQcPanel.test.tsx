import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Subtitle } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { CaptionQcPanel } from "./CaptionQcPanel";

const cue = (id: string, startTime: number, endTime: number, text: string): Subtitle => ({ id, text, startTime, endTime });

const setSubtitles = (subtitles: Subtitle[]) => {
  const project = createEmptyProject("QC");
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...project, timeline: { ...project.timeline, subtitles } },
  });
};

describe("CaptionQcPanel", () => {
  beforeEach(() => useTimelineStore.setState({ playheadPosition: 0 }));
  afterEach(() => {
    cleanup();
    setSubtitles([]);
  });

  it("says when there is nothing to check", () => {
    setSubtitles([]);
    render(<CaptionQcPanel />);
    expect(screen.getByText(/No captions to check/)).toBeTruthy();
  });

  it("passes clean captions", () => {
    setSubtitles([cue("a", 1, 3.5, "A calm sentence."), cue("b", 4, 6.5, "Another one here.")]);
    render(<CaptionQcPanel />);
    expect(screen.getByTestId("caption-qc-clear").textContent).toMatch(/All 2 captions pass/);
  });

  it("lists problems and jumps the playhead to the caption on click", () => {
    setSubtitles([
      cue("fast", 5, 5.4, "Far too many characters for such a short time"),
      cue("next", 5.41, 8, "Right after"),
    ]);
    render(<CaptionQcPanel />);
    const issues = screen.getAllByTestId("caption-qc-issue");
    const codes = issues.map((i) => i.getAttribute("data-code"));
    expect(codes).toEqual(expect.arrayContaining(["cps", "min-duration", "gap"]));
    expect(within(screen.getByTestId("caption-qc-summary")).getByText(/error/)).toBeTruthy();

    const gap = issues.find((i) => i.getAttribute("data-code") === "gap")!;
    fireEvent.click(gap);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(5.41, 2);
  });

  it("applies the limits the user sets", () => {
    setSubtitles([cue("a", 1, 2, "x".repeat(30))]);
    render(<CaptionQcPanel />);
    expect(screen.getAllByTestId("caption-qc-issue").some((i) => i.getAttribute("data-code") === "cps")).toBe(true);
    fireEvent.change(screen.getByLabelText("Max chars/sec"), { target: { value: "60" } });
    expect(screen.queryAllByTestId("caption-qc-issue").some((i) => i.getAttribute("data-code") === "cps")).toBe(false);
  });
});
