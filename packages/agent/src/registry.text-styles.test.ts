import { describe, expect, it } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import type { Subtitle } from "@openreel/core/types/timeline";
import { executeTool } from "./executor";
import { HeadlessHost } from "./headless-host";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";

function setup() {
  const project = makeProjectWithClip();
  const textClip = (id: string) => ({
    id,
    trackId: "tt",
    startTime: 0,
    duration: 4,
    text: id,
    style: { fontFamily: "Inter", fontSize: 40, fontWeight: "bold", fontStyle: "normal", color: "#123456", textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, letterSpacing: 0 },
    transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    keyframes: [],
  });
  (project as { textClips?: unknown }).textClips = [textClip("t1"), textClip("t2")];
  (project.timeline as { subtitles: Subtitle[] }).subtitles = [
    { id: "s1", text: "one", startTime: 0, endTime: 1 },
    { id: "s2", text: "two", startTime: 1, endTime: 2, captionTrackId: "fr" },
  ];
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  const undo = () => new ActionExecutor(history).undo(host.getProject());
  return { host, undo };
}

const textClips = (p: Project) => p.textClips as unknown as Array<{ id: string; scroll?: unknown; style: { color: string; fontSize: number } }>;

describe("text and caption style agent tools", () => {
  it("registers the tools", () => {
    for (const name of ["set_text_scroll", "set_caption_style", "list_saved_styles", "save_text_style", "save_caption_style", "apply_saved_style", "delete_saved_style"])
      expect(getTool(name), name).toBeDefined();
  });

  it("sets a roll title, defaults both ends off-screen, clears it, and undoes", async () => {
    const { host, undo } = setup();
    const r = await executeTool("set_text_scroll", { clipId: "t1", scroll: { mode: "roll" } }, host);
    expect(r.ok, r.summary).toBe(true);
    expect(textClips(host.getProject())[0].scroll).toEqual({ mode: "roll", startOffscreen: true, endOffscreen: true });
    expect((await executeTool("set_text_scroll", { clipId: "t1", scroll: { mode: "crawl", direction: "right", endOffscreen: false } }, host)).ok).toBe(true);
    expect(textClips(host.getProject())[0].scroll).toEqual({ mode: "crawl", direction: "right", startOffscreen: true, endOffscreen: false });
    expect((await executeTool("set_text_scroll", { clipId: "t1", scroll: null }, host)).ok).toBe(true);
    expect(textClips(host.getProject())[0]).not.toHaveProperty("scroll");
    await undo();
    expect(textClips(host.getProject())[0].scroll).toBeDefined();
  });

  it("rejects bad scroll input", async () => {
    const { host } = setup();
    expect((await executeTool("set_text_scroll", { clipId: "nope", scroll: { mode: "roll" } }, host)).ok).toBe(false);
    expect((await executeTool("set_text_scroll", { clipId: "t1", scroll: { mode: "roll", direction: "left" } }, host)).ok).toBe(false);
    expect((await executeTool("set_text_scroll", { clipId: "t1", scroll: { mode: "spin" } }, host)).ok).toBe(false);
  });

  it("styles captions with stroke, shadow, safe margin and cue settings in one undo step", async () => {
    const { host, undo } = setup();
    const r = await executeTool(
      "set_caption_style",
      { style: { strokeColor: "#000", strokeWidth: 3, shadowColor: "#111", safeMargin: 0.1, boxRadius: 8 }, cueSettings: { line: 10, snapToLines: false, align: "left" } },
      host,
    );
    expect(r.ok, r.summary).toBe(true);
    const cues = host.getProject().timeline.subtitles;
    expect(cues).toHaveLength(2);
    for (const cue of cues) {
      expect(cue.style).toMatchObject({ strokeWidth: 3, safeMargin: 0.1, fontFamily: "Inter" });
      expect(cue.cueSettings).toEqual({ line: 10, snapToLines: false, align: "left" });
    }
    await undo();
    expect(host.getProject().timeline.subtitles.every((c) => c.style === undefined && c.cueSettings === undefined)).toBe(true);
  });

  it("targets one caption track and clears cue settings", async () => {
    const { host } = setup();
    await executeTool("set_caption_style", { captionTrackId: "fr", cueSettings: { position: 20 } }, host);
    const [a, b] = host.getProject().timeline.subtitles;
    expect(a.cueSettings).toBeUndefined();
    expect(b.cueSettings).toEqual({ position: 20 });
    await executeTool("set_caption_style", { captionTrackId: "fr", cueSettings: null }, host);
    expect(host.getProject().timeline.subtitles[1].cueSettings).toBeUndefined();
    expect((await executeTool("set_caption_style", { cueSettings: { size: 500 } }, host)).ok).toBe(false);
    expect((await executeTool("set_caption_style", {}, host)).ok).toBe(false);
  });

  it("saves, lists, applies and deletes text styles", async () => {
    const { host, undo } = setup();
    await executeTool("update_text_clip", { clipId: "t1", updates: { style: { color: "#ff0000", fontSize: 99 } } }, host);
    const saved = await executeTool("save_text_style", { name: "Hero", clipId: "t1" }, host);
    expect(saved.ok, saved.summary).toBe(true);
    const listed = await executeTool("list_saved_styles", {}, host);
    expect((listed.data as { text: Array<{ name: string }> }).text.map((s) => s.name)).toEqual(["Hero"]);
    const applied = await executeTool("apply_saved_style", { kind: "text", styleId: "hero", clipIds: ["t2"] }, host);
    expect(applied.ok, applied.summary).toBe(true);
    expect(textClips(host.getProject())[1].style.fontSize).toBe(textClips(host.getProject())[0].style.fontSize);
    await undo();
    expect(textClips(host.getProject())[1].style.color).toBe("#123456");
    expect((await executeTool("delete_saved_style", { kind: "text", styleId: "Hero" }, host)).ok).toBe(true);
    expect((await executeTool("apply_saved_style", { kind: "text", styleId: "Hero", clipIds: ["t2"] }, host)).ok).toBe(false);
  });

  it("saves a caption style from a cue and applies it", async () => {
    const { host } = setup();
    await executeTool("set_caption_style", { subtitleIds: ["s1"], style: { strokeWidth: 5, position: "top" }, cueSettings: { line: 2 } }, host);
    expect((await executeTool("save_caption_style", { name: "Top", subtitleId: "s1" }, host)).ok).toBe(true);
    const applied = await executeTool("apply_saved_style", { kind: "caption", styleId: "Top", subtitleIds: ["s2"] }, host);
    expect(applied.ok, applied.summary).toBe(true);
    const cue = host.getProject().timeline.subtitles[1];
    expect(cue.style?.strokeWidth).toBe(5);
    expect(cue.cueSettings).toEqual({ line: 2 });
  });
});
