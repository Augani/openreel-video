import { describe, expect, it } from "vitest";
import { buildProject } from "./__fixtures__/project";
import { layoutOf } from "./__fixtures__/layout";
import { exportTimeline, importTimeline, resolveFrameRate } from "./index";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import type { Project } from "../types/project";

/** The fixture project with a 10:00:00:00 start timecode on the interview media and the sequence. */
function withTimecode(fps: number, sequenceStart?: string): Project {
  const project = buildProject(fps);
  return {
    ...project,
    settings: { ...project.settings, ...(sequenceStart ? { startTimecode: sequenceStart } : {}) },
    mediaLibrary: {
      ...project.mediaLibrary,
      items: project.mediaLibrary.items.map((m) =>
        m.id === "m-interview" ? { ...m, metadata: { ...m.metadata, startTimecode: 36000, startTimecodeText: "10:00:00:00" } } : m,
      ),
    },
  };
}

describe("embedded source start timecode in timeline exports", () => {
  it("EDL source columns are source timecode (the file's 10:00:00:00 plus the In point), record columns start at the sequence start", () => {
    const edl = exportTimeline(withTimecode(25, "10:00:00:00"), "edl").files[0].content;
    const events = edl.split("\n").filter((l) => /^\d{3}\s/.test(l));
    // clip A: source in = 10:00:00:00 + 30 frames, record in = sequence start
    expect(events[0]).toContain("10:00:01:05 10:00:03:05 10:00:00:00 10:00:02:00");
    // broll has no start timecode: source columns stay file-relative
    const broll = events.find((l) => l.includes("BROLLCLI"));
    expect(broll).toBeDefined();
    expect(broll).toContain("00:00:03:05 00:00:07:05 10:00:02:00 10:00:04:00");
  });

  it("without any timecode the EDL is unchanged (record base 01:00:00:00, source from zero)", () => {
    const edl = exportTimeline(buildProject(25), "edl").files[0].content;
    const first = edl.split("\n").find((l) => /^001\s/.test(l))!;
    expect(first).toContain("00:00:01:05 00:00:03:05 01:00:00:00 01:00:02:00");
  });

  it("xmeml writes the start timecode on the file and on the sequence", () => {
    const xml = exportTimeline(withTimecode(25, "10:00:00:00"), "xmeml").files[0].content;
    expect(xml).toContain("<string>10:00:00:00</string>");
    expect(xml).toContain("<frame>900000</frame>");
    // the sequence's own timecode
    expect(xml.match(/<frame>900000<\/frame>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("FCPXML asset start carries the file's start timecode", () => {
    const xml = exportTimeline(withTimecode(25), "fcpxml").files[0].content;
    expect(xml).toMatch(/<asset id="[^"]+" name="interview\.mp4" start="36000s"/);
    expect(xml).toMatch(/<asset id="[^"]+" name="broll clip\.mov" start="0s"/);
  });

  it.each(["xmeml", "fcpxml"] as const)("%s round trip keeps the cut structure when the media has a start timecode", (format) => {
    const project = withTimecode(25, "10:00:00:00");
    const rate = resolveFrameRate(25);
    const exported = exportTimeline(project, format);
    let n = 0;
    const imported = importTimeline(exported.files[0].content, { mediaItems: project.mediaLibrary.items, makeId: () => `t${++n}` });
    const before = layoutOf(project.timeline.tracks, project.timeline.markers, project.mediaLibrary.items, rate);
    const after = layoutOf(imported.tracks, imported.markers, [...project.mediaLibrary.items, ...imported.newMedia], rate);
    expect(after).toEqual(before);
  });
});

describe("sequence start timecode is an undoable project setting", () => {
  it("sets 10:00:00:00 and clears it again, one undo step each", async () => {
    const project = buildProject(25);
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    expect(project.settings.startTimecode).toBeUndefined();
    const set = await executor.execute({ type: "project/updateSettings", id: "tc1", timestamp: 1, params: { startTimecode: "10:00:00:00" } }, project);
    expect(set.success).toBe(true);
    expect(project.settings.startTimecode).toBe("10:00:00:00");
    expect(history.getUndoStackSize()).toBe(1);
    await executor.undo(project);
    expect(project.settings.startTimecode).toBeUndefined();
    await executor.redo(project);
    expect(project.settings.startTimecode).toBe("10:00:00:00");
    const cleared = await executor.execute({ type: "project/updateSettings", id: "tc2", timestamp: 2, params: { startTimecode: undefined } }, project);
    expect(cleared.success).toBe(true);
    expect(project.settings.startTimecode).toBeUndefined();
    await executor.undo(project);
    expect(project.settings.startTimecode).toBe("10:00:00:00");
  });

  it("projects saved before the setting existed load without it", () => {
    const project = buildProject(25);
    expect("startTimecode" in project.settings).toBe(false);
  });
});
