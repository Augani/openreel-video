import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TitleEngine } from "@openreel/core";
import { WorkspaceTextPanel } from "./WorkspaceTextPanel";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Authored title presets");
  useProjectStore.getState().actionHistory.clear();
  useEditorWorkspaceStore.setState({ textSource: "text", mobileCaptionsOpen: false });
  useTimelineStore.setState({ playheadPosition: 2, playbackLockedReason: null });
  useUIStore.getState().clearSelection();
});
afterEach(() => { cleanup(); useProjectStore.getState().actionHistory.clear(); });

describe("authored title insertion", () => {
  it.each([
    ["Chapter One", "Fraunces", 600, "#f2e6d0"],
    ["Breaking", "Space Grotesk", 700, "#111111"],
  ] as const)("inserts %s as editable text with its authored font and one Undo", async (name, family, weight, color) => {
    const before = useProjectStore.getState().getFullProject();
    const view = render(<WorkspaceTextPanel presets={[]} defaultStyle={{ fontSize: 96, fontWeight: 800 }} />);
    fireEvent.click(view.getByRole("button", { name }));
    await waitFor(() => expect(useProjectStore.getState().getAllTextClips()).toHaveLength(1));
    const clip = useProjectStore.getState().getAllTextClips()[0];
    expect(clip).toMatchObject({ text: name === "Breaking" ? "BREAKING" : name, startTime: 2, duration: 5,
      style: { fontFamily: family, fontWeight: weight, color, strokeWidth: 0 } });
    if (name === "Breaking") expect(clip.style.backgroundColor).toBe("#f5d547");
    expect(useUIStore.getState().selectedItems).toContainEqual({ type: "text-clip", id: clip.id, trackId: clip.trackId });
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getAllTextClips()).toHaveLength(0);
    expect(useProjectStore.getState().getFullProject().timeline.tracks).toEqual(before.timeline.tracks);
  });
});
