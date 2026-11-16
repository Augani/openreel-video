import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { createEmptyProject } from "../stores/project/project-helpers";
import { restoreProjectPlaceholders } from "./restore-project-placeholders";
import { loadDirectoryHandle, loadFileHandle } from "./media-storage";

vi.mock("./media-storage", () => ({loadFileHandle:vi.fn(),loadDirectoryHandle:vi.fn()}));
const file = new File(["audio"],"Missing.wav",{type:"audio/wav"});
const item: MediaItem = {id:"media",name:file.name,type:"audio",blob:null,fileHandle:null,thumbnailUrl:null,waveformData:null,isPlaceholder:true,
  sourceFile:{name:file.name,size:file.size,lastModified:file.lastModified,folder:"Original"},
  metadata:{duration:4,width:0,height:0,frameRate:0,codec:"pcm",fileSize:file.size,sampleRate:48000,channels:2},
};
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; }
function setup() {
  const base=createEmptyProject("Saved handles");
  const project={...base,mediaLibrary:{...base.mediaLibrary,items:[item]}};
  let active=true;
  const current=new Map([[item.id,item]]);
  const replace=vi.fn(async(id:string,source:File,_folder?:string)=>{current.set(id,{...item,blob:source,isPlaceholder:false});return {success:true};});
  return {project,current,replace,setActive:(value:boolean)=>{active=value;},host:{isCurrent:()=>active,getItem:(id:string)=>current.get(id),replace}};
}
function directory(entries: Array<{kind:string;getFile?:()=>Promise<File>}>) {
  return {folderName:"Relinked",handle:{async *entries(){for(const [index,handle] of entries.entries()) yield [String(index),handle];}}} as unknown as Awaited<ReturnType<typeof loadDirectoryHandle>>;
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadFileHandle).mockResolvedValue(null);vi.mocked(loadDirectoryHandle).mockResolvedValue(null);});
describe("saved placeholder handles",()=>{
  it("restores the original source and does not scan the folder when it succeeds",async()=>{
    const s=setup(),handle={getFile:vi.fn(async()=>file)} as unknown as FileSystemFileHandle;
    vi.mocked(loadFileHandle).mockResolvedValue(handle);
    expect(await restoreProjectPlaceholders(s.project,s.host)).toBe(1);
    expect(s.replace).toHaveBeenCalledWith(item.id,file,"Original");
    expect(loadDirectoryHandle).not.toHaveBeenCalled();
  });
  it("drops a handle lookup from a previous project session",async()=>{
    const s=setup(),lookup=deferred<FileSystemFileHandle|null>();
    vi.mocked(loadFileHandle).mockReturnValue(lookup.promise);
    const pending=restoreProjectPlaceholders(s.project,s.host);
    s.setActive(false);lookup.resolve({getFile:vi.fn(async()=>file)} as unknown as FileSystemFileHandle);
    expect(await pending).toBe(0);expect(s.replace).not.toHaveBeenCalled();
  });
  it("retains a manually replaced source while a saved file is being read",async()=>{
    const s=setup(),read=deferred<File>();
    vi.mocked(loadFileHandle).mockResolvedValue({getFile:()=>read.promise} as unknown as FileSystemFileHandle);
    const pending=restoreProjectPlaceholders(s.project,s.host);
    await vi.waitFor(()=>expect(loadFileHandle).toHaveBeenCalled());
    s.current.set(item.id,{...item,blob:new File(["new"],"New.wav"),isPlaceholder:false});
    read.resolve(file);
    expect(await pending).toBe(0);expect(s.replace).not.toHaveBeenCalled();
  });
  it("falls back after a rejected decode and counts only the successful folder restoration",async()=>{
    const s=setup();
    vi.mocked(loadFileHandle).mockResolvedValue({getFile:async()=>file} as FileSystemFileHandle);
    vi.mocked(loadDirectoryHandle).mockResolvedValue(directory([{kind:"file",getFile:async()=>file}]));
    s.replace.mockResolvedValueOnce({success:false});
    expect(await restoreProjectPlaceholders(s.project,s.host)).toBe(1);
    expect(s.replace).toHaveBeenNthCalledWith(1,item.id,file,"Original");
    expect(s.replace).toHaveBeenNthCalledWith(2,item.id,file,"Relinked");
  });
  it("ignores an unavailable directory entry and stops scanning once every wanted source is found",async()=>{
    const s=setup(),unused=vi.fn(async()=>file);
    vi.mocked(loadDirectoryHandle).mockResolvedValue(directory([{kind:"file",getFile:async()=>{throw new Error("Missing");}},
      {kind:"file",getFile:async()=>new File(["other"],"Other.wav")},{kind:"file",getFile:async()=>file},{kind:"file",getFile:unused}]));
    expect(await restoreProjectPlaceholders(s.project,s.host)).toBe(1);expect(unused).not.toHaveBeenCalled();
  });
  it("does not scan a folder returned after its project session closes",async()=>{
    const s=setup(),lookup=deferred<Awaited<ReturnType<typeof loadDirectoryHandle>>>();
    vi.mocked(loadDirectoryHandle).mockReturnValue(lookup.promise);
    const pending=restoreProjectPlaceholders(s.project,s.host);
    await vi.waitFor(()=>expect(loadDirectoryHandle).toHaveBeenCalled());
    s.setActive(false);lookup.resolve(directory([{kind:"file",getFile:async()=>file}]));
    expect(await pending).toBe(0);expect(s.replace).not.toHaveBeenCalled();
  });
  it("does not publish a folder entry after a project change during its read",async()=>{
    const s=setup(),read=deferred<File>(),getFile=vi.fn(()=>read.promise);
    vi.mocked(loadDirectoryHandle).mockResolvedValue(directory([{kind:"file",getFile}]));
    const pending=restoreProjectPlaceholders(s.project,s.host);
    await vi.waitFor(()=>expect(getFile).toHaveBeenCalled());
    s.setActive(false);read.resolve(file);
    expect(await pending).toBe(0);expect(s.replace).not.toHaveBeenCalled();
  });
});
