import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { TrackHeader } from "./TrackHeader";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";

const track = (id: string, type: Track["type"], name: string): Track => ({
  id, type, name, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false,
});
const noop = () => undefined;
const header = (t: Track) => (
  <TrackHeader track={t} index={0} onDragStart={noop} onDragOver={noop} onDrop={noop} onDragEnd={noop} />
);

beforeEach(() => useEditorWorkspaceStore.setState({ targetTracks: {} }));
afterEach(cleanup);

describe("TrackHeader insert/overwrite target toggle", () => {
  it("toggles the video target in the workspace store", () => {
    render(header(track("main", "video", "Main")));
    const toggle = screen.getByRole("button", { name: "Target Main" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(useEditorWorkspaceStore.getState().targetTracks.video).toBe("main");
    expect(screen.getByRole("button", { name: "Untarget Main" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Untarget Main" }));
    expect(useEditorWorkspaceStore.getState().targetTracks.video).toBeUndefined();
  });

  it("keeps video and audio targets independent", () => {
    render(header(track("dlg", "audio", "Dialogue")));
    fireEvent.click(screen.getByRole("button", { name: "Target Dialogue" }));
    expect(useEditorWorkspaceStore.getState().targetTracks).toEqual({ audio: "dlg" });
  });

  it("has no target toggle on text tracks", () => {
    render(header(track("t", "text", "Titles")));
    expect(screen.queryByRole("button", { name: /Target Titles/ })).toBeNull();
  });
});
