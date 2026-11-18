import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}-${Math.random()}`,
  timestamp: Date.now(),
  params,
});

function makeProject(): Project {
  const clip = (id: string, color: string) => ({
    id,
    trackId: "tt",
    startTime: 0,
    duration: 3,
    text: id,
    style: { fontFamily: "Inter", fontSize: 40, color },
    transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    keyframes: [],
  });
  return {
    id: "p",
    name: "T",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 5,
      markers: [],
      tracks: [],
      subtitles: [
        { id: "s1", text: "one", startTime: 0, endTime: 1, style: { fontFamily: "A", fontSize: 20, color: "#111", backgroundColor: "#000", position: "bottom" } },
        { id: "s2", text: "two", startTime: 1, endTime: 2, cueSettings: { line: 0 } },
      ],
    },
    textClips: [clip("t1", "#111111"), clip("t2", "#222222")],
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const lib = (p: Project) => p.savedStyles;
const clips = (p: Project) => p.textClips as unknown as Array<{ id: string; style: { color: string; strokeWidth?: number }; scroll?: unknown }>;

describe("saved text styles", () => {
  const style = { fontFamily: "Bebas", fontSize: 90, color: "#ff0000", strokeWidth: 4 };

  it("saves by name, overwrites the same name, deletes, and undoes each", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    await ex.execute(act("style/save", { kind: "text", id: "st1", name: "Hero", style }), p);
    expect(lib(p)?.text).toHaveLength(1);
    await ex.execute(act("style/save", { kind: "text", id: "st2", name: "  hero ", style: { ...style, fontSize: 10 } }), p);
    expect(lib(p)?.text).toHaveLength(1);
    expect(lib(p)?.text[0].id).toBe("st1");
    expect(lib(p)?.text[0].style.fontSize).toBe(10);
    await ex.undo(p);
    expect(lib(p)?.text[0].style.fontSize).toBe(90);
    await ex.execute(act("style/delete", { kind: "text", styleId: "Hero" }), p);
    expect(lib(p)?.text).toHaveLength(0);
    await ex.undo(p);
    expect(lib(p)?.text).toHaveLength(1);
  });

  it("applies to several clips as one undo step, including a saved scroll", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    const scroll = { mode: "roll", startOffscreen: true, endOffscreen: true };
    await ex.execute(act("style/save", { kind: "text", id: "st1", name: "Credits", style, scroll }), p);
    const before = structuredClone(clips(p));
    const res = await ex.execute(act("style/applyText", { clipIds: ["t1", "t2"], styleId: "st1" }), p);
    expect(res.success).toBe(true);
    expect(clips(p).map((c) => c.style.color)).toEqual(["#ff0000", "#ff0000"]);
    expect(clips(p)[0].scroll).toEqual(scroll);
    await ex.undo(p);
    expect(clips(p)).toEqual(before);
    expect(clips(p)[0]).not.toHaveProperty("scroll");
    await ex.redo(p);
    expect(clips(p)[1].style.strokeWidth).toBe(4);
  });

  it("clears an existing scroll when the saved style has none, and undo restores it", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    const scroll = { mode: "crawl", startOffscreen: true, endOffscreen: false };
    (p.textClips as unknown as Array<{ scroll?: unknown }>)[0].scroll = scroll;
    await ex.execute(act("style/save", { kind: "text", id: "st1", name: "Plain", style }), p);
    await ex.execute(act("style/applyText", { clipIds: ["t1"], styleId: "st1" }), p);
    expect(clips(p)[0]).not.toHaveProperty("scroll");
    await ex.undo(p);
    expect(clips(p)[0].scroll).toEqual(scroll);
  });

  it("rejects unknown styles and clips", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    expect((await ex.execute(act("style/applyText", { clipIds: ["t1"], styleId: "x" }), p)).success).toBe(false);
    await ex.execute(act("style/save", { kind: "text", id: "st1", name: "A", style }), p);
    expect((await ex.execute(act("style/applyText", { clipIds: ["nope"], styleId: "A" }), p)).success).toBe(false);
    expect((await ex.execute(act("style/save", { kind: "text", id: "x", name: " ", style }), p)).success).toBe(false);
  });
});

describe("saved caption styles", () => {
  const style = { fontFamily: "Inter", fontSize: 36, color: "#fff", backgroundColor: "transparent", position: "top" as const, strokeColor: "#000", strokeWidth: 3, safeMargin: 0.08 };

  it("applies style and cue settings to the chosen cues only, and undoes", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    await ex.execute(act("style/save", { kind: "caption", id: "c1", name: "Lower", style, cueSettings: { line: 80, snapToLines: false, align: "left" } }), p);
    const before = structuredClone(p.timeline.subtitles);
    const res = await ex.execute(act("style/applyCaption", { subtitleIds: ["s2"], styleId: "Lower" }), p);
    expect(res.success).toBe(true);
    const [s1, s2] = p.timeline.subtitles;
    expect(s1).toEqual(before[0]);
    expect(s2.style).toEqual(style);
    expect(s2.cueSettings).toEqual({ line: 80, snapToLines: false, align: "left" });
    await ex.undo(p);
    expect(p.timeline.subtitles).toEqual(before);
    await ex.redo(p);
    expect(p.timeline.subtitles[1].style?.strokeWidth).toBe(3);
  });

  it("clears stale cue settings when the saved style has none", async () => {
    const ex = new ActionExecutor();
    const p = makeProject();
    await ex.execute(act("style/save", { kind: "caption", id: "c1", name: "Plain", style }), p);
    await ex.execute(act("style/applyCaption", { subtitleIds: ["s2"], styleId: "c1" }), p);
    expect(p.timeline.subtitles[1]).not.toHaveProperty("cueSettings");
  });
});
