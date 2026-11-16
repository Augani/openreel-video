import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useRef } from "react";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { ClipComponent } from "./ClipComponent";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { Timeline } from "../Timeline";

const clip: Clip = { id: "clip", mediaId: "source", trackId: "main", startTime: 0, duration: 4,
  inPoint: 0, outPoint: 4, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 },
};
const track: Track = { id: "main", name: "Main", type: "video", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false };
const media: MediaItem = { id: "source", name: "Source.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 4, width: 640, height: 360, frameRate: 30, codec: "h264", fileSize: 0, sampleRate: 0, channels: 0 },
};
beforeEach(() => {
  const project = createEmptyProject("Native pointer QA");
  useProjectStore.getState().loadProject({ ...project, timeline: { ...project.timeline, tracks: [track] }, mediaLibrary: { items: [media] } });
  useUIStore.setState({ selectedItems: [], exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useTimelineStore.setState({ playbackLockedReason: null });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    return this.hasAttribute("data-timeline-clip") ? new DOMRect(0,4,200,60) : new DOMRect(0,0,1000,100);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount() {
  const select = vi.fn(), background = vi.fn(), move = vi.fn(async () => {});
  function Timeline() {
    const ref = useRef<HTMLDivElement>(null);
    return <div ref={ref} onClick={background}><ClipComponent clip={clip} track={track} allTracks={[track]}
      pixelsPerSecond={50} scrollX={0} viewportWidth={1000} isSelected={false}
      trackHeights={new Map([[track.id,60]])} timelineRef={ref}
      onSelect={select} onMoveClip={move} onSnapIndicator={() => {}}/></div>;
  }
  render(<Timeline/>);
  return { select, background, move, button: screen.getByRole("button",{name:"Select clip Source.mp4"}) };
}

describe("native clip pointer ordering", () => {
  it("does not bubble the click that immediately follows pending-drag mouseup to timeline deselection", async () => {
    const { button,select,background,move } = mount();
    fireEvent.mouseDown(button,{button:0,clientX:20,clientY:20});
    await act(async () => {
      fireEvent.mouseUp(window,{button:0,clientX:20,clientY:20});
      fireEvent.click(button,{button:0,clientX:20,clientY:20});
    });
    expect(select).toHaveBeenCalledWith(clip.id,false);
    expect(background).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
  it("retains an existing multi-selection after the asynchronous drop and release click", async () => {
    const companion = { ...clip, id: "companion", startTime: 5 };
    const project = useProjectStore.getState().project;
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: [{ ...track, clips: [clip, companion] }],
    } } });
    useUIStore.setState({ selectedItems: [clip.id, companion.id].map(id => ({ type: "clip" as const, id })) });
    useUIStore.setState({ snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
    useTimelineStore.setState({ pixelsPerSecond: 50, scrollX: 0, scrollY: 0, playheadPosition: 0, viewportWidth: 1000, viewportHeight: 100 });
    render(<StrictMode><Timeline /></StrictMode>);
    const button = screen.getAllByRole("button", { name: "Select clip Source.mp4" })[0];
    fireEvent.mouseDown(button, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 120, clientY: 20 });
    await act(async () => { fireEvent.mouseUp(window, { button: 0, clientX: 120, clientY: 20 }); });
    await waitFor(() => expect(button.className).not.toContain("cursor-grabbing"));
    fireEvent.click(button, { button: 0, clientX: 120, clientY: 20 });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([clip.id, companion.id]);
    expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(2);
    expect(useProjectStore.getState().getClip(companion.id)?.startTime).toBe(7);
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
  });
  it.each([false,true])("keeps a multi-frame drag in one real Undo step with linked audio=%s", async linked => {
    useEditorWorkspaceStore.setState({ linkedSelection:linked });
    useTimelineStore.setState({pixelsPerSecond:50,scrollX:0,scrollY:0,playheadPosition:0,viewportWidth:1000,viewportHeight:100});
    useUIStore.setState({snapSettings:{...useUIStore.getState().snapSettings,enabled:false}});
    if(linked){
      const project=useProjectStore.getState().project;
      const audio={...clip,id:"audio",trackId:"dialogue",mediaId:"audio-source",metadata:{separatedFromClipId:clip.id}};
      useProjectStore.setState({project:{...project,timeline:{...project.timeline,tracks:[track,{...track,id:"dialogue",name:"Dialogue",type:"audio",clips:[audio]}]},
        mediaLibrary:{items:[media,{...media,id:"audio-source",name:"Dialogue.wav",type:"audio"}]}}});
    }
    render(<Timeline/>);
    const button=screen.getByRole("button",{name:"Select clip Source.mp4"});
    fireEvent.mouseDown(button,{button:0,clientX:20,clientY:20});
    fireEvent.mouseMove(window,{buttons:1,clientX:120,clientY:20});
    await waitFor(()=>expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(2));
    fireEvent.mouseMove(window,{buttons:1,clientX:170,clientY:20});
    await waitFor(()=>expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(3));
    await act(async()=>{fireEvent.mouseUp(window,{button:0,clientX:170,clientY:20});fireEvent.click(button,{button:0,clientX:170,clientY:20});});
    await waitFor(()=>expect(button.className).not.toContain("cursor-grabbing"));
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
    await act(async()=>{expect((await useProjectStore.getState().undo()).success).toBe(true);});
    expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(0);
    if(linked) expect(useProjectStore.getState().getClip("audio")?.startTime).toBe(0);
  });
  it.each([false, true])("undoes a cross-track drop and its timing together with linked audio=%s", async linked => {
    useEditorWorkspaceStore.setState({ linkedSelection: linked });
    useTimelineStore.setState({ pixelsPerSecond: 50, scrollX: 0, scrollY: 0, playheadPosition: 0, viewportWidth: 1000, viewportHeight: 200 });
    useUIStore.setState({ snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
    const project = useProjectStore.getState().project;
    const destination = { ...track, id: "destination", name: "B-roll", clips: [] };
    const audio = { ...clip, id: "audio", trackId: "dialogue", mediaId: "audio-source", metadata: { separatedFromClipId: clip.id } };
    useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
      tracks: [track, destination, ...(linked ? [{ ...track, id: "dialogue", name: "Dialogue", type: "audio" as const, clips: [audio] }] : [])],
    }, mediaLibrary: { items: [media, ...(linked ? [{ ...media, id: "audio-source", name: "Dialogue.wav", type: "audio" as const }] : [])] } } });
    render(<StrictMode><Timeline /></StrictMode>);
    const button = screen.getByRole("button", { name: "Select clip Source.mp4" });
    await act(async () => {
      fireEvent.mouseDown(button, { button: 0, clientX: 20, clientY: 20 });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 120, clientY: 20 });
      fireEvent.mouseMove(window, { buttons: 1, clientX: 170, clientY: 80 });
      fireEvent.mouseUp(window, { button: 0, clientX: 170, clientY: 80 });
    });
    await waitFor(() => expect(useProjectStore.getState().getClip(clip.id)?.trackId).toBe(destination.id));
    expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(3);
    expect(useProjectStore.getState().actionHistory.getDisplayHistory()).toHaveLength(1);
    await act(async () => { expect((await useProjectStore.getState().undo()).success).toBe(true); });
    expect(useProjectStore.getState().getClip(clip.id)?.trackId).toBe(track.id);
    expect(useProjectStore.getState().getClip(clip.id)?.startTime).toBe(0);
    if (linked) expect(useProjectStore.getState().getClip("audio")?.startTime).toBe(0);
  });
});
