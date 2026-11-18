import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphicsEngine, TitleEngine, defaultMotionShaderParams,
  getMotionShaderTextDefs, getMotionShaderFillDefs, getMotionShaderEffectDefs } from "@openreel/core";
import { openContextMenu } from "../../../test/open-context-menu";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { GraphicsClipContextMenu } from "./GraphicsClipContextMenu";

const state = () => useProjectStore.getState();
const materialDefs = [...getMotionShaderTextDefs(), ...getMotionShaderFillDefs(), ...getMotionShaderEffectDefs()];
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  state().createNewProject("Timeline menus");
  state().actionHistory.setAutoGroupWindow(0);
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});
afterEach(() => { cleanup(); useUIStore.getState().clearSelection(); });

describe("graphics context-menu editing", () => {
  it.each(materialDefs.slice(0, 2))("duplicates $id text material with complete clip data and one Undo", async def => {
    const track = state().project.timeline.tracks[0];
    const clip = state().createTextClip(track.id, 2, "Keep this material", 3, {
      shader: { shaderId: def.id, params: defaultMotionShaderParams(def), progress: .37 },
      color: "rgba(100, 140, 200, 0.4)", shadowColor: "#4422aa", shadowBlur: 4,
    }, { captionSource: "menu-test" })!;
    state().actionHistory.clear();
    const before = structuredClone(state().getTextClip(clip.id)!);
    openContextMenu(<GraphicsClipContextMenu clip={clip} clipType="text" />);
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" })));
    await waitFor(() => expect(state().project.textClips).toHaveLength(2));
    const duplicate = state().project.textClips!.find(item => item.id !== clip.id)!;
    expect({ ...duplicate, id: before.id, startTime: before.startTime }).toEqual(before);
    expect(duplicate.startTime).toBeGreaterThanOrEqual(before.startTime + before.duration);
    await act(async () => { await state().undo(); });
    expect(state().project.textClips).toEqual([before]);
    expect(state().canUndo()).toBe(false);
  });

  it.each(["shape", "svg", "sticker", "emoji"] as const)("duplicates and deletes %s clips through undoable menu actions", async kind => {
    const track = state().project.timeline.tracks[0];
    const clip = kind === "shape" ? state().createShapeClip(track.id, 0, "rectangle", 3)!
      : kind === "svg" ? state().importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>', track.id, 0, 3)!
      : state().createStickerClip({ id: "sticker-menu", trackId: track.id, startTime: 0, duration: 3,
        type: kind, imageUrl: "data:image/png;base64,AA==", keyframes: [], effects: [],
        transform: { position: { x: .5, y: .5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } })!;
    state().actionHistory.clear();
    const all = () => kind === "shape" ? state().project.shapeClips! : kind === "svg" ? state().project.svgClips! : state().project.stickerClips!;
    const before = structuredClone(all());
    openContextMenu(<GraphicsClipContextMenu clip={clip} clipType={kind} />);
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" })));
    expect(all()).toHaveLength(2);
    expect({ ...all()[1], id: clip.id, startTime: clip.startTime }).toEqual(before[0]);
    await act(async () => { await state().undo(); });
    expect(all()).toEqual(before);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Test clip" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Delete" })));
    expect(all()).toHaveLength(0);
    await act(async () => { await state().undo(); });
    expect(all()).toEqual(before);
  });

  it.each(["locked", "exporting", "processing"])("disables mutation for a %s timeline while leaving selection available", async reason => {
    const track = state().project.timeline.tracks[0];
    const clip = state().createTextClip(track.id, 0, "Keep", 2)!;
    if (reason === "locked") await state().lockTrack(track.id, true);
    if (reason === "exporting") useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    if (reason === "processing") useTimelineStore.setState({ playbackLockedReason: "processing" });
    state().actionHistory.clear();
    openContextMenu(<GraphicsClipContextMenu clip={clip} clipType="text" />);
    for (const name of ["Duplicate", "Delete"]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item).toHaveAttribute("data-disabled");
      fireEvent.click(item);
    }
    expect(screen.getByRole("menuitem", { name: "Select All Clips on Track" })).not.toHaveAttribute("data-disabled");
    expect(state().project.textClips).toHaveLength(1);
    expect(state().canUndo()).toBe(false);
  });

  it("rejects an old open menu after project replacement even when a clip ID is reused", async () => {
    const track = state().project.timeline.tracks[0];
    const clip = state().createTextClip(track.id, 0, "First project", 2)!;
    openContextMenu(<GraphicsClipContextMenu clip={clip} clipType="text" />);
    act(() => useProjectStore.setState({ project: { ...state().project, id: "replacement-project" } }));
    state().actionHistory.clear();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Delete" })));
    expect(state().project.textClips).toHaveLength(1);
    expect(state().canUndo()).toBe(false);
  });
});
