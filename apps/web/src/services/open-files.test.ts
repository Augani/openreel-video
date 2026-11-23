import { describe, expect, it, vi } from "vitest";
import { routeOpenedFiles, type OpenFilesDeps } from "./open-files";

function deps(over: Partial<OpenFilesDeps> & { open?: boolean } = {}) {
  let open = over.open ?? false;
  const calls: string[] = [];
  const d: OpenFilesDeps = {
    hasOpenProject: () => open,
    openProject: vi.fn(async (p: string) => {
      calls.push(`open:${p}`);
      open = true;
      return true;
    }),
    askWhichProject: vi.fn(async () => {
      calls.push("ask");
      open = true;
      return true;
    }),
    readCaptionFile: vi.fn(async (p: string) => new File(["1\n00:00:01,000 --> 00:00:02,000\nhi\n"], p.split("/").pop()!)),
    importCaptions: vi.fn(async (files: File[]) => {
      calls.push(`import:${files.map((f) => f.name).join(",")}`);
      return files.length * 3;
    }),
    notify: vi.fn(),
    ...over,
  };
  return { d, calls };
}

describe("routing opened files in the renderer", () => {
  it("a project file opens as the project", async () => {
    const { d, calls } = deps();
    const out = await routeOpenedFiles([{ kind: "project", path: "/films/A.oreel" }], d);
    expect(calls).toEqual(["open:/films/A.oreel"]);
    expect(out).toEqual({ opened: "/films/A.oreel", imported: 0, skipped: [] });
    expect(d.askWhichProject).not.toHaveBeenCalled();
  });
  it("captions are imported into the project that is open, with no question", async () => {
    const { d, calls } = deps({ open: true });
    const out = await routeOpenedFiles([{ kind: "captions", path: "/s/a.srt" }, { kind: "captions", path: "/s/b.vtt" }], d);
    expect(calls).toEqual(["import:a.srt,b.vtt"]);
    expect(out.imported).toBe(6);
    expect(d.askWhichProject).not.toHaveBeenCalled();
    expect(d.openProject).not.toHaveBeenCalled();
  });
  it("captions with no project open: asks which project, then imports into it", async () => {
    const { d, calls } = deps();
    const out = await routeOpenedFiles([{ kind: "captions", path: "/s/a.srt" }], d);
    expect(calls).toEqual(["ask", "import:a.srt"]);
    expect(d.askWhichProject).toHaveBeenCalledWith(1);
    expect(out.imported).toBe(3);
  });
  it("captions with no project open and the question declined: nothing is imported and the user is told", async () => {
    const { d } = deps({ askWhichProject: vi.fn(async () => false) });
    const out = await routeOpenedFiles([{ kind: "captions", path: "/s/a.scc" }], d);
    expect(d.importCaptions).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ path: "/s/a.scc", reason: "No project was chosen." }]);
    expect(d.notify).toHaveBeenCalledWith("info", "Captions not imported", expect.any(String));
  });
  it("a project and captions together: the project opens first and the captions go into it, without asking", async () => {
    const { d, calls } = deps();
    await routeOpenedFiles([{ kind: "captions", path: "/s/a.srt" }, { kind: "project", path: "/films/A.oreel" }], d);
    expect(calls).toEqual(["open:/films/A.oreel", "import:a.srt"]);
  });
  it("a project that cannot be opened does not receive the captions that came with it", async () => {
    const { d } = deps({ open: true, openProject: vi.fn(async () => false) });
    const out = await routeOpenedFiles([{ kind: "project", path: "/films/bad.oreel" }, { kind: "captions", path: "/s/a.srt" }], d);
    expect(d.importCaptions).not.toHaveBeenCalled();
    expect(out.opened).toBeNull();
    expect(out.skipped.map((s) => s.path)).toEqual(["/films/bad.oreel", "/s/a.srt"]);
  });
  it("only the first of several projects opens; the rest are named", async () => {
    const { d, calls } = deps();
    const out = await routeOpenedFiles([{ kind: "project", path: "/f/A.oreel" }, { kind: "project", path: "/f/B.oreel" }], d);
    expect(calls).toEqual(["open:/f/A.oreel"]);
    expect(out.skipped).toEqual([{ path: "/f/B.oreel", reason: "Only one project can be open at a time." }]);
    expect(d.notify).toHaveBeenCalledWith("info", "Opened one project", expect.stringContaining("B.oreel"));
  });
  it("an unreadable caption file is reported and the others still import", async () => {
    const { d, calls } = deps({ open: true });
    (d.readCaptionFile as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("The file is too large to be a caption file.");
    });
    const out = await routeOpenedFiles([{ kind: "captions", path: "/s/big.srt" }, { kind: "captions", path: "/s/ok.srt" }], d);
    expect(calls).toEqual(["import:ok.srt"]);
    expect(out.skipped).toEqual([{ path: "/s/big.srt", reason: "The file is too large to be a caption file." }]);
    expect(d.notify).toHaveBeenCalledWith("error", "Could not read big.srt", expect.any(String));
  });
});
