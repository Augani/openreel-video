import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Track } from "@openreel/core";
import { TrackHeader } from "./TrackHeader";
import { SourcePatch } from "../SourcePatch";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useSourceMonitorStore } from "../../../stores/source-monitor-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";

const track = (id: string, name: string): Track => ({
  id, type: "audio", name, clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false,
}) as Track;
const noop = () => undefined;
const header = (t: Track) => <TrackHeader track={t} index={0} onDragStart={noop} onDragOver={noop} onDrop={noop} onDragEnd={noop} />;

const media = (id: string, channels: number) => ({
  id, name: `${id}.wav`, type: "audio" as const, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 5, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48000, channels, fileSize: 1, hasAudio: true },
});

beforeEach(() => {
  const project = createEmptyProject("t");
  useProjectStore.setState({
    project: { ...project, mediaLibrary: { items: [media("poly", 8), media("pair", 2)] }, timeline: { ...project.timeline, tracks: [track("a1", "Audio 1"), track("a2", "Audio 2")] } } as never,
  });
  useEditorWorkspaceStore.setState({ targetTracks: {}, channelPatches: {}, disabledChannels: [] });
  useSourceMonitorStore.setState({ mediaId: null });
});
afterEach(cleanup);

describe("multichannel source patch indicators", () => {
  it("shows the classic single A toggle when the Source monitor clip has one audio clip", () => {
    useSourceMonitorStore.setState({ mediaId: "pair" });
    render(header(track("a2", "Audio 2")));
    expect(screen.getByRole("button", { name: "Target Audio 2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Source patch Audio 2" })).toBeNull();
  });

  it("the track header shows which channel is patched to it and lets any channel be patched or unpatched", async () => {
    useSourceMonitorStore.setState({ mediaId: "poly" });
    render(header(track("a2", "Audio 2")));
    const chip = screen.getByRole("button", { name: "Source patch Audio 2" });
    expect(chip.textContent).toBe("A");
    useEditorWorkspaceStore.getState().setChannelPatch(3, "a2");
    expect((await screen.findByRole("button", { name: "Source patch Audio 2" })).textContent).toBe("A4");
    useEditorWorkspaceStore.getState().setChannelPatch(0, "a2");
    expect((await screen.findByRole("button", { name: "Source patch Audio 2" })).textContent).toBe("A1");
    expect(useEditorWorkspaceStore.getState().channelPatches).toEqual({});
  });

  it("the source monitor patch shows one indicator per audio channel, each switchable and patchable", () => {
    render(<SourcePatch hasVideo={false} hasAudio media={useProjectStore.getState().project.mediaLibrary.items[0]} />);
    const group = screen.getByTestId("source-patch");
    expect(group.getAttribute("data-multichannel")).toBe("8");
    for (let channel = 0; channel < 8; channel++) expect(screen.getByRole("button", { name: `Disable source A${channel + 1}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disable source A3" }));
    expect(useEditorWorkspaceStore.getState().disabledChannels).toEqual([2]);
    expect(screen.getByRole("button", { name: "Enable source A3" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Enable source A3" }));
    expect(useEditorWorkspaceStore.getState().disabledChannels).toEqual([]);
  });

  it("a stereo source keeps the plain A patch", () => {
    render(<SourcePatch hasVideo={false} hasAudio media={useProjectStore.getState().project.mediaLibrary.items[1]} />);
    expect(screen.getByTestId("source-patch").getAttribute("data-multichannel")).toBeNull();
    expect(screen.queryByTestId("source-patch-channel-toggle-0")).toBeNull();
  });
});
