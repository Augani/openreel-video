import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor, type Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import MixerSnapshots from "./MixerSnapshots";

const state = () => useProjectStore.getState();
const tracks = () => state().project.timeline.tracks;

function setup() {
  const project = createEmptyProject("Snapshots");
  const base = {
    clips: [], transitions: [], locked: false, hidden: false, solo: false,
  };
  const next: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: [
        { ...base, id: "a", name: "Dialogue", type: "audio", muted: false, audioRack: { effects: [], volume: 0.8 } },
        { ...base, id: "b", name: "Music", type: "audio", muted: false },
      ] as Project["timeline"]["tracks"],
    },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({ project: next, hasOpenProject: true, actionExecutor: executor, actionHistory: executor.getHistory() });
}

beforeEach(setup);
afterEach(cleanup);

describe("MixerSnapshots", () => {
  it("saves the mix, recalls it after changes, and undoes the recall", async () => {
    render(<MixerSnapshots />);
    fireEvent.click(screen.getByTestId("mixer-snapshots-open"));
    fireEvent.change(screen.getByTestId("mixer-snapshot-name"), { target: { value: "Dialogue forward" } });
    fireEvent.click(screen.getByTestId("mixer-snapshot-save"));
    await waitFor(() => expect(screen.getByTestId("mixer-snapshot-list").textContent).toContain("Dialogue forward"));
    expect(state().project.timeline.mixerSnapshots).toHaveLength(1);

    await act(async () => {
      await state().muteTrack("a", true);
      await state().setAudioRack("b", { effects: [], volume: 0.2 });
    });
    expect(tracks().find((t) => t.id === "a")?.muted).toBe(true);

    fireEvent.click(screen.getByTestId("mixer-snapshot-recall"));
    await waitFor(() => expect(tracks().find((t) => t.id === "a")?.muted).toBe(false));
    expect(tracks().find((t) => t.id === "b")?.audioRack).toBeUndefined();
    expect(tracks().find((t) => t.id === "a")?.audioRack?.volume).toBe(0.8);

    await act(async () => {
      await state().undo();
    });
    expect(tracks().find((t) => t.id === "a")?.muted).toBe(true);
    expect(tracks().find((t) => t.id === "b")?.audioRack?.volume).toBe(0.2);
  });
});
