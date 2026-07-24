import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { TrackHeader } from "./TrackHeader";

function audioTrack(id: string, name: string): Track {
  return {
    id,
    type: "audio",
    name,
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

const noop = () => undefined;

function renderHeader(track: Track) {
  return render(
    <TrackHeader
      track={track}
      index={0}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
    />,
  );
}

describe("TrackHeader audio controls", () => {
  beforeEach(() => {
    const project = createEmptyProject("Audio controls");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [audioTrack("dialogue", "Dialogue"), audioTrack("music", "Music")],
        },
      },
    });
    useProjectStore.getState().actionExecutor.getHistory().clear();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
  });

  it("exposes solo directly in the timeline and persists it undoably", async () => {
    renderHeader(useProjectStore.getState().project.timeline.tracks[0]);

    expect(screen.getByText("Dialogue")).toHaveClass("cursor-grab");

    fireEvent.click(screen.getByRole("button", { name: "Solo Dialogue" }));

    await waitFor(() => {
      expect(useProjectStore.getState().project.timeline.tracks[0]?.solo).toBe(true);
      expect(useProjectStore.getState().actionExecutor.getHistory().canUndo()).toBe(true);
    });
  });

  it("uses explicit mute state and accessible track-specific labels", async () => {
    const view = renderHeader(useProjectStore.getState().project.timeline.tracks[1]);

    fireEvent.click(screen.getByRole("button", { name: "Mute Music" }));
    await waitFor(() => {
      expect(useProjectStore.getState().project.timeline.tracks[1]?.muted).toBe(true);
    });

    view.rerender(
      <TrackHeader
        track={useProjectStore.getState().project.timeline.tracks[1]}
        index={1}
        onDragStart={noop}
        onDragOver={noop}
        onDrop={noop}
        onDragEnd={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Unmute Music" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
