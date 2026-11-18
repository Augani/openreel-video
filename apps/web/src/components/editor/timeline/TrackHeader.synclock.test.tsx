import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { TrackHeader } from "./TrackHeader";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useProjectStore } from "../../../stores/project-store";

const track = (id: string, type: Track["type"], name: string, extra: Partial<Track> = {}): Track => ({
  id, type, name, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra,
});
const noop = () => undefined;
const header = (t: Track) => (
  <TrackHeader track={t} index={0} onDragStart={noop} onDragOver={noop} onDrop={noop} onDragEnd={noop} />
);

beforeEach(() => useEditorWorkspaceStore.setState({ targetTracks: {}, targetedTrackIds: [] }));
afterEach(cleanup);

describe("TrackHeader sync lock and track target", () => {
  it("shows Sync Lock on by default and off only when the track says false", () => {
    render(header(track("a", "audio", "Music")));
    const toggle = screen.getByRole("button", { name: "Sync lock Music" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-sync-lock", "on");
    cleanup();
    render(header(track("a", "audio", "Music", { syncLock: false })));
    expect(screen.getByRole("button", { name: "Sync lock Music" })).toHaveAttribute("data-sync-lock", "off");
  });

  it("clicking Sync Lock sets the opposite value through the store", () => {
    const setTrackSyncLock = vi.fn(async () => ({ success: true }));
    useProjectStore.setState({ setTrackSyncLock } as never);
    render(header(track("a", "audio", "Music")));
    fireEvent.click(screen.getByRole("button", { name: "Sync lock Music" }));
    expect(setTrackSyncLock).toHaveBeenCalledWith("a", false);
  });

  it("the V1/A1 badge is the multi-track target toggle, independent of the source patch", () => {
    render(header(track("v1", "video", "Main")));
    const toggle = screen.getByRole("button", { name: "Track target Main" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(useEditorWorkspaceStore.getState().targetedTrackIds).toEqual(["v1"]);
    expect(useEditorWorkspaceStore.getState().targetTracks).toEqual({});
    expect(screen.getByRole("button", { name: "Track target Main" })).toHaveAttribute("data-track-targeted", "true");
    fireEvent.click(screen.getByRole("button", { name: "Track target Main" }));
    expect(useEditorWorkspaceStore.getState().targetedTrackIds).toEqual([]);
  });

  it("text tracks have a sync lock but no target toggle", () => {
    render(header(track("t", "text", "Titles")));
    expect(screen.queryByRole("button", { name: /Track target/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sync lock Titles" })).toBeInTheDocument();
  });
});
