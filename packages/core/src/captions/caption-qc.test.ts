import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { checkCaptions, visibleRows } from "./caption-qc";

const cue = (id: string, startTime: number, endTime: number, text: string, track?: string): Subtitle => ({
  id,
  text,
  startTime,
  endTime,
  ...(track !== undefined ? { captionTrackId: track } : {}),
});

const codes = (subs: Subtitle[], options = {}) => checkCaptions(subs, options).issues.map((i) => i.code);

describe("checkCaptions", () => {
  it("accepts well-formed captions", () => {
    const r = checkCaptions([cue("a", 1, 3.5, "A calm sentence."), cue("b", 4, 6.5, "Another one here.")]);
    expect(r.issues).toEqual([]);
    expect(r.cueCount).toBe(2);
    expect(r.errorCount + r.warningCount).toBe(0);
  });

  it("flags reading speed in characters per second and words per minute", () => {
    const text = "This is far too much text to read in one second";
    const r = checkCaptions([cue("a", 1, 2, text)]);
    const cps = r.issues.find((i) => i.code === "cps")!;
    expect(cps.value).toBeCloseTo(text.length, 0);
    expect(cps.limit).toBe(17);
    expect(cps.severity).toBe("error"); // more than 30% over
    expect(r.issues.some((i) => i.code === "wpm")).toBe(true);
    expect(r.worstCps).toBeCloseTo(text.length, 0);
  });

  it("marks a slightly fast cue as a warning", () => {
    const r = checkCaptions([cue("a", 1, 3, "x".repeat(36))]); // 18 cps
    expect(r.issues.find((i) => i.code === "cps")?.severity).toBe("warning");
  });

  it("counts rows and row length", () => {
    expect(codes([cue("a", 1, 9, "one\ntwo\nthree")])).toContain("max-lines");
    const r = checkCaptions([cue("a", 1, 9, "x".repeat(43))]);
    expect(r.issues.find((i) => i.code === "max-chars")?.value).toBe(43);
    expect(codes([cue("a", 1, 9, "x".repeat(42))])).not.toContain("max-chars");
  });

  it("flags short and long cues", () => {
    expect(codes([cue("a", 1, 1.5, "ok")])).toContain("min-duration");
    expect(codes([cue("a", 1, 9, "ok")])).toContain("max-duration");
    expect(codes([cue("a", 1, 1 + 5 / 6, "ok")])).not.toContain("min-duration");
  });

  it("flags gaps shorter than two frames and overlaps, but not wider gaps", () => {
    const fps = 25;
    const near = codes([cue("a", 1, 3, "one"), cue("b", 3 + 1 / fps, 5, "two")], { frameRate: fps });
    expect(near).toContain("gap");
    const touching = codes([cue("a", 1, 3, "one"), cue("b", 3, 5, "two")], { frameRate: fps });
    expect(touching).toContain("gap");
    const ok = codes([cue("a", 1, 3, "one"), cue("b", 3 + 2 / fps, 5, "two")], { frameRate: fps });
    expect(ok).not.toContain("gap");
    const over = checkCaptions([cue("a", 1, 3, "one"), cue("b", 2.5, 5, "two")]);
    expect(over.issues.find((i) => i.code === "overlap")?.severity).toBe("error");
  });

  it("flags empty cues and ignores markup when counting", () => {
    expect(codes([cue("a", 1, 3, "  \n ")])).toContain("empty");
    expect(visibleRows("<i>a</i>\n{\\an8}b")).toEqual(["a", "b"]);
    expect(codes([cue("a", 1, 3, "<i>" + "x".repeat(30) + "</i>")])).not.toContain("cps");
  });

  it("checks one caption track and orders issues by time with jump targets", () => {
    const subs = [
      cue("en1", 10, 10.5, "ok", "en"),
      cue("es1", 2, 2.5, "ok", "es"),
      cue("en0", 4, 4.5, "ok", "en"),
    ];
    const r = checkCaptions(subs, { captionTrackId: "en" });
    expect(r.cueCount).toBe(2);
    expect(r.issues.map((i) => [i.cueId, i.time])).toEqual([["en0", 4], ["en1", 10]]);
    expect(r.counts["min-duration"]).toBe(2);
  });

  it("lets limits be overridden", () => {
    expect(codes([cue("a", 1, 3, "x".repeat(60))], { maxCps: 40 })).not.toContain("cps");
  });
});
