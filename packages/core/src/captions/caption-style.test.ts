import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { exportSrt, exportVtt, formatCueSettings, parseCaptions, parseCueSettings } from "./caption-formats";
import { layoutCaption, wrapCaptionLines } from "./caption-layout";

const measure = (t: string) => t.length * 10;
const cue = (over: Partial<Subtitle> = {}): Subtitle => ({ id: "c1", text: "Hello world", startTime: 1, endTime: 2, ...over });

describe("WebVTT cue settings", () => {
  it("parses line, position, size and align", () => {
    expect(parseCueSettings("line:-2 position:20%,line-left size:60% align:start")).toEqual({
      line: -2,
      snapToLines: true,
      position: 20,
      positionAlign: "line-left",
      size: 60,
      align: "start",
    });
    expect(parseCueSettings("line:10%,center")).toEqual({ line: 10, snapToLines: false, lineAlign: "center" });
  });

  it("ignores malformed settings", () => {
    expect(parseCueSettings("position:150% size:abc align:sideways line:auto foo")).toBeUndefined();
  });

  it("round-trips through export and import", () => {
    const settings = { line: 12, snapToLines: false, lineAlign: "end" as const, position: 30, positionAlign: "line-left" as const, size: 50, align: "left" as const };
    const vtt = exportVtt([cue({ cueSettings: settings })]);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000 line:12%,end position:30%,line-left size:50% align:left");
    const parsed = parseCaptions(vtt);
    expect(parsed.errors).toEqual([]);
    expect(parsed.subtitles[0].cueSettings).toEqual(settings);
    expect(parsed.subtitles[0].text).toBe("Hello world");
  });

  it("maps the style position to a line when no cue settings exist", () => {
    expect(formatCueSettings({ style: { position: "top" } as never })).toBe(" line:0");
    expect(formatCueSettings({ style: { position: "bottom" } as never })).toBe("");
  });

  it("writes a ::cue STYLE block for colour, background and shadow", () => {
    const style = { fontFamily: "Inter", fontSize: 30, color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", position: "bottom" as const, shadowColor: "#000", shadowBlur: 2, shadowOffsetX: 1, shadowOffsetY: 1 };
    const vtt = exportVtt([cue({ style })]);
    expect(vtt).toMatch(/^WEBVTT\n\nSTYLE\n::cue \{/);
    expect(vtt).toContain("text-shadow: 1px 1px 2px #000;");
    expect(parseCaptions(vtt).subtitles).toHaveLength(1);
  });

  it("SRT carries no cue settings", () => {
    expect(exportSrt([cue({ cueSettings: { line: 0 } })])).not.toContain("line");
  });
});

describe("caption layout", () => {
  const style = { fontFamily: "Inter", fontSize: 20, color: "#fff", backgroundColor: "#000", position: "bottom" as const };

  it("keeps the legacy bottom margin without safeMargin", () => {
    const l = layoutCaption({ text: "Hi", style }, 1000, 500, measure);
    expect(l.boxes[0].y + l.boxes[0].height).toBeCloseTo(500 - 40);
  });

  it("applies a safe margin to the bottom edge", () => {
    const l = layoutCaption({ text: "Hi", style: { ...style, safeMargin: 0.1 } }, 1000, 500, measure);
    expect(l.boxes[0].y + l.boxes[0].height).toBeCloseTo(450);
  });

  it("places top, center and negative lines", () => {
    const top = layoutCaption({ text: "Hi", style: { ...style, position: "top" } }, 1000, 500, measure);
    expect(top.boxes[0].y).toBeCloseTo(40);
    const mid = layoutCaption({ text: "Hi", style: { ...style, position: "center" } }, 1000, 500, measure);
    expect(mid.boxes[0].y + mid.boxes[0].height / 2).toBeCloseTo(250);
    const last = layoutCaption({ text: "Hi", style, cueSettings: { line: -1 } }, 1000, 500, measure);
    expect(last.boxes[0].y + last.boxes[0].height).toBeCloseTo(460);
  });

  it("uses a percentage line when snapToLines is false", () => {
    const l = layoutCaption({ text: "Hi", style, cueSettings: { line: 50, snapToLines: false } }, 1000, 500, measure);
    expect(l.boxes[0].y).toBeCloseTo(250);
  });

  it("anchors by position/align and wraps at size", () => {
    const left = layoutCaption({ text: "Hi", style, cueSettings: { align: "left" } }, 1000, 500, measure);
    expect(left.lines[0].x).toBe(10);
    const right = layoutCaption({ text: "Hi", style, cueSettings: { align: "right" } }, 1000, 500, measure);
    expect(right.lines[0].x + right.lines[0].width).toBe(990);
    const narrow = layoutCaption({ text: "aaaa bbbb cccc dddd", style, cueSettings: { size: 10 } }, 1000, 500, measure);
    expect(narrow.lines.length).toBeGreaterThan(1);
    for (const line of narrow.boxes) expect(line.width).toBeLessThanOrEqual(120);
  });

  it("wrapCaptionLines breaks on width and keeps explicit newlines", () => {
    expect(wrapCaptionLines("aa bb\ncc", 1000, measure)).toEqual(["aa bb", "cc"]);
    expect(wrapCaptionLines("aaaa bbbb", 50, measure)).toEqual(["aaaa", "bbbb"]);
  });
});
