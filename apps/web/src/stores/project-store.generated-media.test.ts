import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { createEmptyProject } from "./project/project-helpers";
import { saveMediaBlob } from "../services/media-storage";

vi.mock("../services/media-storage",async original=>({...await original<typeof import("../services/media-storage")>(),saveMediaBlob:vi.fn(async()=>{})}));
const source:MediaItem={id:"generated",name:"Pending.png",type:"image",blob:null,fileHandle:null,thumbnailUrl:null,waveformData:null,isPlaceholder:true,isPending:true,kieaiTaskId:"task",
  metadata:{duration:0,width:0,height:0,frameRate:0,codec:"",sampleRate:0,channels:0,fileSize:0}};
beforeEach(()=>{
  vi.clearAllMocks();const project=createEmptyProject("Generated image");
  useProjectStore.getState().loadProject({...project,mediaLibrary:{items:[source]}});
});
afterEach(()=>{vi.unstubAllGlobals();});
describe("generated image ownership",()=>{
  it.each(["new session","manual replacement"])("drops decoded output after %s and releases its bitmap",async change=>{
    let finish!:(bitmap:ImageBitmap)=>void;
    vi.stubGlobal("createImageBitmap",vi.fn(()=>new Promise<ImageBitmap>(resolve=>{finish=resolve;})));
    const result=useProjectStore.getState().replacePlaceholderMedia(source.id,new Blob(["image"],{type:"image/png"}),"Generated.png");
    if(change==="new session") useProjectStore.getState().loadProject({...useProjectStore.getState().project,name:"Reloaded current project"});
    else {
      const current=useProjectStore.getState().project;
      useProjectStore.setState({project:{...current,mediaLibrary:{items:[{...source,blob:new File(["manual"],"Manual.png"),isPlaceholder:false,name:"Manual.png"}]}}});
    }
    const expected=useProjectStore.getState().project,close=vi.fn();
    finish({width:100,height:100,close} as unknown as ImageBitmap);
    await result;
    expect(useProjectStore.getState().project).toBe(expected);expect(close).toHaveBeenCalledOnce();
    expect(saveMediaBlob).not.toHaveBeenCalled();
  });
});
