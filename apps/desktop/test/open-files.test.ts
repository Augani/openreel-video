import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { OpenFileRouter, extractOpenPaths } from "../src/main/open-files";
import type { OpenFileItem } from "../src/shared/file-associations";

const cwd = path.resolve("/work");
const abs = (...parts: string[]) => path.resolve(...parts);

describe("extractOpenPaths: files named on a command line", () => {
  it("packaged app: skips the executable, Chromium switches and files of other types", () => {
    const argv = ["/Applications/OpenReel.app/Contents/MacOS/OpenReel", "--allow-file-access-from-files", "--user-data-dir=/tmp/x", abs("/films/A.oreel"), abs("/subs/a.srt"), abs("/media/clip.mov"), "--flag"];
    expect(extractOpenPaths(argv, { cwd })).toEqual([
      { kind: "project", path: abs("/films/A.oreel") },
      { kind: "captions", path: abs("/subs/a.srt") },
    ]);
  });
  it("development (`electron .`): skips the electron binary and the app path too", () => {
    expect(extractOpenPaths(["/node_modules/electron/dist/electron", ".", abs("/films/A.oreel")], { cwd, defaultApp: true })).toEqual([{ kind: "project", path: abs("/films/A.oreel") }]);
    // Without defaultApp the second entry would be read as a file name (a dot has no extension, so still ignored).
    expect(extractOpenPaths(["electron", "x.oreel"], { cwd })).toEqual([{ kind: "project", path: abs("/work/x.oreel") }]);
  });
  it("resolves a relative path against the launching process's working directory", () => {
    expect(extractOpenPaths(["OpenReel", "films/A.oreel", "../subs/b.vtt"], { cwd })).toEqual([
      { kind: "project", path: abs("/work/films/A.oreel") },
      { kind: "captions", path: abs("/subs/b.vtt") },
    ]);
  });
  it("accepts every caption format, in any case, and a quoted path", () => {
    const names = ["a.SRT", "b.vtt", "c.scc", "d.mcc", "e.stl", "f.ttml", "g.dfxp"];
    expect(extractOpenPaths(["OpenReel", ...names.map((n) => abs("/s", n)), `"${abs("/s/quoted one.srt")}"`], { cwd }).map((i) => i.kind)).toEqual(Array(8).fill("captions"));
  });
  it("drops duplicates and paths that do not exist", () => {
    const exists = (p: string) => !p.includes("gone");
    const result = extractOpenPaths(["OpenReel", abs("/a/x.srt"), abs("/a/x.srt"), abs("/a/gone.srt")], { cwd, exists });
    expect(result).toEqual([{ kind: "captions", path: abs("/a/x.srt") }]);
  });
  it("returns nothing for a plain launch", () => {
    expect(extractOpenPaths(["OpenReel"], { cwd })).toEqual([]);
    expect(extractOpenPaths(["OpenReel", "--inspect=9229", ""], { cwd })).toEqual([]);
  });
});

function makeRouter(canSend = true) {
  const sent: OpenFileItem[][] = [];
  const send = vi.fn((items: OpenFileItem[]) => {
    if (!canSend) return false;
    sent.push(items);
    return true;
  });
  const show = vi.fn();
  const router = new OpenFileRouter({ send, show });
  return { router, sent, send, show };
}

describe("OpenFileRouter", () => {
  it("macOS open-file before the window has loaded: queued, the app is surfaced, the renderer collects them when it starts", () => {
    const { router, sent, show } = makeRouter();
    router.addPaths([abs("/films/A.oreel")]);
    expect(sent).toEqual([]);
    expect(show).toHaveBeenCalled();
    expect(router.takePending()).toEqual([{ kind: "project", path: abs("/films/A.oreel") }]);
    expect(router.takePending()).toEqual([]);
  });
  it("a first launch with files on the command line is queued the same way", () => {
    const { router } = makeRouter();
    router.addArgv(["OpenReel", abs("/subs/a.srt")], cwd);
    expect(router.takePending()).toEqual([{ kind: "captions", path: abs("/subs/a.srt") }]);
  });
  it("after the renderer is ready, files go straight to it and the window comes forward", () => {
    const { router, sent, show } = makeRouter();
    router.takePending();
    show.mockClear();
    router.addArgv(["OpenReel", abs("/films/B.oreel"), abs("/subs/b.vtt")], cwd);
    expect(sent).toEqual([[{ kind: "project", path: abs("/films/B.oreel") }, { kind: "captions", path: abs("/subs/b.vtt") }]]);
    expect(show).toHaveBeenCalled();
    expect(router.pendingCount()).toBe(0);
  });
  it("second-instance argv: a relative path is resolved against the second process's directory, not ours", () => {
    const { router, sent } = makeRouter();
    router.takePending();
    router.addArgv(["OpenReel", "cap.scc"], abs("/other/dir"));
    expect(sent[0]).toEqual([{ kind: "captions", path: abs("/other/dir/cap.scc") }]);
  });
  it("holds files again while the page reloads, and does not queue the same file twice", () => {
    const { router, sent } = makeRouter();
    router.takePending();
    router.rendererLoading();
    router.addPaths([abs("/subs/a.srt")]);
    router.addPaths([abs("/subs/a.srt")]);
    expect(sent).toEqual([]);
    expect(router.pendingCount()).toBe(1);
    expect(router.takePending()).toHaveLength(1);
  });
  it("keeps the files when the editor window is gone (send refuses)", () => {
    const { router } = makeRouter(false);
    router.takePending();
    router.addPaths([abs("/films/A.oreel")]);
    expect(router.pendingCount()).toBe(1);
  });
  it("ignores files the app is not associated with and does not even surface the window", () => {
    const { router, show } = makeRouter();
    expect(router.addPaths([abs("/media/a.mov")])).toEqual([]);
    expect(router.addArgv(["OpenReel", "--foo"], cwd)).toEqual([]);
    expect(show).not.toHaveBeenCalled();
  });
});
