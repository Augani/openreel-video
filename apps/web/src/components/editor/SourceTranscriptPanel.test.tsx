import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { sourceTranscriptOf, type MediaItem } from "@openreel/core";
import SourceTranscriptPanel from "./SourceTranscriptPanel";
import { useProjectStore } from "../../stores/project-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { getSourceTranscriptStore } from "../../stores/source-transcript-store";

describe("SourceTranscriptPanel selection safety", () => {
  beforeEach(() => {
    useSourceMonitorStore.getState().bindProject(useProjectStore.getState().project.id);
    useSourceMonitorStore.setState({ mediaId: "m1", externalPreview: null } as never);
  });

  it("renders without crashing when the selected words disappear (transcript removed after selecting)", async () => {
    const media = { id: "m1", name: "a", type: "video", metadata: { duration: 10 } } as unknown as MediaItem;
    useProjectStore.setState((s) => ({
      project: { ...s.project, mediaLibrary: { ...s.project.mediaLibrary, items: [media] } },
    }));
    const store = getSourceTranscriptStore();
    const cues = [{ id: "c", text: "hello brave world", startTime: 1, endTime: 4, words: [
      { text: "hello", startTime: 1, endTime: 2 }, { text: "brave", startTime: 2, endTime: 3 }, { text: "world", startTime: 3, endTime: 4 } ] }];
    const record = { version: 1 as const, mediaHash: "h", duration: 10, engine: "import", createdAt: 0, cues };
    act(() => {
      store.setState({ refresh: async () => store.getState().entries.m1, entries: { m1: { status: "ready", mediaHash: "h", record, transcript: sourceTranscriptOf(record) } } });
    });
    const { container } = render(<SourceTranscriptPanel />);
    const word = container.querySelector("[data-word-index='1']") as HTMLElement;
    act(() => { word.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); });
    expect(screen.getByTestId("source-transcript-selection-range").textContent).not.toBe("");
    expect(screen.getByTestId("source-transcript-selection-range").textContent).not.toBe("");
    act(() => {
      store.setState({ entries: { m1: { status: "none" } } });
    });
    expect(container.querySelector("[data-testid=source-transcript-panel]")).toBeTruthy();
    expect(screen.queryByTestId("source-transcript-selection-range")?.textContent).toBe("");
  });
});
