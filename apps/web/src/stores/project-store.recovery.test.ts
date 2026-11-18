import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { useTimelineStore } from "./timeline-store";
import { useUIStore } from "./ui-store";
import { useEngineStore } from "./engine-store";
import { autoSaveManager } from "../services/auto-save";
import { projectManager } from "../services/project-manager";
import { createEmptyProject } from "./project/project-helpers";
import { loadProjectMedia } from "../services/media-storage";
import { restoreMediaItem } from "../utils/media-recovery";

vi.mock("../services/media-storage", async (original) => ({
  ...await original<typeof import("../services/media-storage")>(), loadProjectMedia: vi.fn(async () => []),
}));
vi.mock("../utils/media-recovery", async (original) => ({
  ...await original<typeof import("../utils/media-recovery")>(), restoreMediaItem: vi.fn(),
}));

let previous = createEmptyProject("Current unsaved edit"), incoming = createEmptyProject("Saved draft");
const oldFile = {kind:"native" as const,path:"/current.oreel"};
beforeEach(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL=vi.fn();
  previous=createEmptyProject("Current unsaved edit"); incoming=createEmptyProject("Saved draft");
  useProjectStore.getState().loadProject(previous);
  useTimelineStore.setState({playbackLockedReason:null,playheadPosition:12});
  useTimelineStore.getState().setLoopRange(2,4);
  useUIStore.setState({exportState:{...useUIStore.getState().exportState,isExporting:false}});
  projectManager.activatePickedProject({project:previous,fileHandle:oldFile});
  vi.spyOn(useProjectStore.getState(),"forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager,"recover").mockImplementation(async()=>incoming);
  vi.spyOn(projectManager,"addToRecent").mockResolvedValue();
  vi.mocked(loadProjectMedia).mockResolvedValue([]);
});
afterEach(()=>{vi.restoreAllMocks();projectManager.releaseCurrentFileHandle();});

describe("atomic autosave recovery",()=>{
  it("saves intervening edits before publishing the recovered project and resets the old view/history",async()=>{
    let finish!:()=>void;
    const save=vi.mocked(useProjectStore.getState().forceSave);
    save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const before=useProjectStore.getState().project;
    const pending=useProjectStore.getState().recoverFromAutoSave("draft");
    await vi.waitFor(()=>expect(save).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project).toBe(before);
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
    useProjectStore.setState({project:{...before,name:"New edit during save"}});
    finish();
    await expect(pending).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(useProjectStore.getState().project.id).toBe(incoming.id);
    expect(projectManager.getCurrentFileHandle()).toBeNull();
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(useTimelineStore.getState().loopStart).toBe(0);
    expect(useTimelineStore.getState().loopEnd).toBe(0);
    expect(useProjectStore.getState().actionHistory.canUndo()).toBe(false);
  });
  it("retains the project and file target on save failure and releases only staged thumbnails",async()=>{
    incoming={...incoming,mediaLibrary:{...incoming.mediaLibrary,items:[{id:"image",name:"Image",type:"image",thumbnailUrl:"blob:previous-session"} as MediaItem]}};
    vi.mocked(restoreMediaItem).mockResolvedValue({...incoming.mediaLibrary.items[0],thumbnailUrl:"blob:new-staged-thumbnail"});
    const revoke=vi.spyOn(URL,"revokeObjectURL");
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(new Error("Storage full"));
    const before=useProjectStore.getState().project;
    await expect(useProjectStore.getState().recoverFromAutoSave("draft")).resolves.toBe(false);
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().error).toBe("Storage full");
    expect(projectManager.getCurrentFileHandle()).toBe(oldFile);
    expect(revoke).toHaveBeenCalledWith("blob:new-staged-thumbnail");
    expect(revoke).not.toHaveBeenCalledWith("blob:previous-session");
  });
  it("rejects a stale recovery when another project opens during media restoration",async()=>{
    let finish!:()=>void;
    vi.mocked(loadProjectMedia).mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve([]);}));
    const save=vi.mocked(useProjectStore.getState().forceSave);
    const pending=useProjectStore.getState().recoverFromAutoSave("draft");
    await vi.waitFor(()=>expect(loadProjectMedia).toHaveBeenCalled());
    const other=createEmptyProject("Another project");
    useProjectStore.getState().loadProject(other);
    const otherFile={kind:"native" as const,path:"/other.oreel"};
    projectManager.activatePickedProject({project:other,fileHandle:otherFile});
    finish();
    await expect(pending).resolves.toBe(false);
    expect(useProjectStore.getState().project.id).toBe(other.id);
    expect(projectManager.getCurrentFileHandle()).toBe(otherFile);
    expect(save).not.toHaveBeenCalled();
    expect(useProjectStore.getState().error).toBeNull();
  });
  it.each(["export","edit"])("does not replace work when %s starts during recovery",async operation=>{
    let finish!:(project:typeof incoming)=>void;
    vi.mocked(autoSaveManager.recover).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=useProjectStore.getState().recoverFromAutoSave("draft");
    if(operation==="export") useUIStore.setState({exportState:{...useUIStore.getState().exportState,isExporting:true}});
    else useTimelineStore.getState().lockPlayback("Editing");
    finish(incoming);
    await expect(pending).resolves.toBe(false);
    expect(useProjectStore.getState().project.id).toBe(previous.id);
    expect(useProjectStore.getState().forceSave).not.toHaveBeenCalled();
  });
  it("allows one recovery at a time and can retry after a missing record",async()=>{
    let finish!:(project:null)=>void;
    vi.mocked(autoSaveManager.recover).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const first=useProjectStore.getState().recoverFromAutoSave("missing");
    await expect(useProjectStore.getState().recoverFromAutoSave("other")).resolves.toBe(false);
    expect(autoSaveManager.recover).toHaveBeenCalledOnce();
    finish(null); await expect(first).resolves.toBe(false);
    await expect(useProjectStore.getState().recoverFromAutoSave("draft")).resolves.toBe(true);
  });
  it("reports success after commit even if updating the recent list fails",async()=>{
    vi.spyOn(console,"warn").mockImplementation(()=>{});
    vi.mocked(projectManager.addToRecent).mockRejectedValueOnce(new Error("Recent list unavailable"));
    await expect(useProjectStore.getState().recoverFromAutoSave("draft")).resolves.toBe(true);
    expect(useProjectStore.getState().project.id).toBe(incoming.id);
  });
  it("clears text and graphics left by a previous project when a legacy snapshot omits those fields",async()=>{
    incoming={...incoming,textClips:undefined,shapeClips:undefined,svgClips:undefined,stickerClips:undefined};
    const loadTextClips=vi.fn(),loadShapeClips=vi.fn(),loadSVGClips=vi.fn(),loadStickerClips=vi.fn();
    vi.spyOn(useEngineStore.getState(),"getTitleEngine").mockReturnValue({loadTextClips} as never);
    vi.spyOn(useEngineStore.getState(),"getGraphicsEngine").mockReturnValue({loadShapeClips,loadSVGClips,loadStickerClips} as never);
    await expect(useProjectStore.getState().recoverFromAutoSave("draft")).resolves.toBe(true);
    for(const load of [loadTextClips,loadShapeClips,loadSVGClips,loadStickerClips]) expect(load).toHaveBeenCalledWith([]);
  });
  it("bounds thumbnail restoration to two jobs and preserves library order",async()=>{
    incoming={...incoming,mediaLibrary:{...incoming.mediaLibrary,items:Array.from({length:4},(_,index)=>({id:String(index),name:`Image ${index}`,type:"image"} as MediaItem))}};
    const finish=new Map<string,()=>void>();
    let active=0, peak=0;
    vi.mocked(restoreMediaItem).mockImplementation(item=>new Promise(resolve=>{
      active++; peak=Math.max(peak,active);
      finish.set(item.id,()=>{active--;resolve(item);});
    }));
    const pending=useProjectStore.getState().recoverFromAutoSave("draft");
    await vi.waitFor(()=>expect(finish.size).toBe(2));
    finish.get("1")!();
    await vi.waitFor(()=>expect(finish.has("2")).toBe(true));
    finish.get("2")!();
    await vi.waitFor(()=>expect(finish.has("3")).toBe(true));
    finish.get("3")!();finish.get("0")!();
    await expect(pending).resolves.toBe(true);
    expect(peak).toBe(2);
    expect(useProjectStore.getState().project.mediaLibrary.items.map(item=>item.id)).toEqual(["0","1","2","3"]);
  });
});
