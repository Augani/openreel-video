import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { AssetsPanel } from "./AssetsPanel";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { saveDirectoryHandle } from "../../services/media-storage";
import { toast } from "../../stores/notification-store";

vi.mock("../../services/media-storage",async original=>({...await original<typeof import("../../services/media-storage")>(),saveDirectoryHandle:vi.fn(async()=>{}),saveFileHandle:vi.fn(async()=>{})}));
const file=new File(["source"],"Missing.wav",{type:"audio/wav"});
const media:MediaItem={id:"shared-id",name:file.name,type:"audio",blob:null,fileHandle:null,thumbnailUrl:null,waveformData:null,isPlaceholder:true,
  sourceFile:{name:file.name,size:file.size,lastModified:file.lastModified},metadata:{duration:4,width:0,height:0,frameRate:0,codec:"pcm",sampleRate:48000,channels:2,fileSize:file.size}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function load(name:string){const project=createEmptyProject(name);useProjectStore.getState().loadProject({...project,mediaLibrary:{items:[media]}});}
beforeEach(()=>{
  vi.clearAllMocks();load("Original");useEditorWorkspaceStore.getState().setSection("media");
  useTimelineStore.setState({playbackLockedReason:null});useUIStore.setState({selectedItems:[],exportState:{...useUIStore.getState().exportState,isExporting:false}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();delete (window as Window & {showDirectoryPicker?:unknown}).showDirectoryPicker;});
function folder(getFile=async()=>file){return {name:"Sources",async *entries(){yield [file.name,{kind:"file",getFile}];}} as unknown as FileSystemDirectoryHandle;}

describe("relink picker ownership",()=>{
  it("ignores a file choice after the same project is reloaded into a new editing session",async()=>{
    const replace=vi.spyOn(useProjectStore.getState(),"replaceMediaAsset").mockResolvedValue({success:true});
    const pickedInputs:HTMLInputElement[]=[];
    vi.spyOn(HTMLInputElement.prototype,"click").mockImplementation(function(this:HTMLInputElement){pickedInputs.push(this);});
    render(<AssetsPanel/>);
    fireEvent.keyDown(screen.getByRole("button",{name:"Media actions for Missing.wav"}),{key:"ArrowDown"});
    fireEvent.click(await screen.findByRole("menuitem",{name:"Replace asset"}));
    const input=pickedInputs[0];expect(input).toBeDefined();
    act(()=>useProjectStore.getState().loadProject({...useProjectStore.getState().project,name:"Reloaded"}));
    await act(async()=>{fireEvent.change(input,{target:{files:[file]}});});
    expect(replace).not.toHaveBeenCalled();
  });
  it("does not associate a folder picked for the old project with a new project",async()=>{
    const picked=deferred<FileSystemDirectoryHandle>();
    Object.defineProperty(window,"showDirectoryPicker",{configurable:true,value:vi.fn(()=>picked.promise)});
    const replace=vi.spyOn(useProjectStore.getState(),"replaceMediaAsset").mockResolvedValue({success:true});
    render(<AssetsPanel/>);fireEvent.click(screen.getByRole("button",{name:"Relink from Folder"}));
    act(()=>load("New project"));
    await act(async()=>picked.resolve(folder()));
    expect(saveDirectoryHandle).not.toHaveBeenCalled();expect(replace).not.toHaveBeenCalled();
  });
  it("stops a folder read if the open project changes before the file is available",async()=>{
    const read=deferred<File>(),getFile=vi.fn(()=>read.promise);
    Object.defineProperty(window,"showDirectoryPicker",{configurable:true,value:vi.fn(async()=>folder(getFile))});
    const replace=vi.spyOn(useProjectStore.getState(),"replaceMediaAsset").mockResolvedValue({success:true});
    render(<AssetsPanel/>);fireEvent.click(screen.getByRole("button",{name:"Relink from Folder"}));
    await waitFor(()=>expect(getFile).toHaveBeenCalled());
    act(()=>load("Another project"));await act(async()=>read.resolve(file));
    expect(replace).not.toHaveBeenCalled();
  });
  it("does not report a failed replacement as successfully relinked",async()=>{
    Object.defineProperty(window,"showDirectoryPicker",{configurable:true,value:vi.fn(async()=>folder())});
    vi.spyOn(useProjectStore.getState(),"replaceMediaAsset").mockResolvedValue({success:false,error:{code:"DECODE_ERROR",message:"Unreadable audio"}});
    const success=vi.spyOn(toast,"success"),error=vi.spyOn(toast,"error");
    render(<AssetsPanel/>);fireEvent.click(screen.getByRole("button",{name:"Relink from Folder"}));
    await waitFor(()=>expect(error).toHaveBeenCalledWith("No assets relinked",expect.any(String)));
    expect(success).not.toHaveBeenCalled();
  });
});
