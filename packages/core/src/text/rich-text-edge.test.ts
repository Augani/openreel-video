import { describe, expect, it } from "vitest";
import { applyRunStyle, editRuns, runsText, parseRuns, migrateTextClipRuns, normalizeRuns } from "./rich-text";
import { layoutRichText } from "./rich-text-layout";
import { DEFAULT_TEXT_STYLE } from "./types";
import { TitleEngine } from "./title-engine";

const base = { ...DEFAULT_TEXT_STYLE, fontSize: 10, lineHeight: 1 };
const measure = (t: string, s: { fontSize: number; letterSpacing: number }) => ({ width: t.length * (s.fontSize * 0.5 + s.letterSpacing), ascent: s.fontSize * 0.8, descent: s.fontSize * 0.2 });

describe("rich text edge cases", () => {
  it("NaN/out-of-range selection does not restyle everything", () => {
    const runs = [{ text: "abc", style: {} }];
    expect(applyRunStyle(runs, NaN, 2, { fontWeight: 700 })).toEqual(runs);
    expect(applyRunStyle(runs, 5, 9, { fontWeight: 700 })).toEqual(runs);
    expect(applyRunStyle(runs, -3, 1, { fontWeight: 700 }).map((r) => r.text)).toEqual(["a", "bc"]);
  });
  it("edits: delete all, retype, emoji, middle", () => {
    let runs = applyRunStyle([{ text: "Big Win", style: {} }], 4, 7, { fontWeight: 700 });
    expect(editRuns(runs, "")).toEqual([]);
    runs = editRuns(runs, "Big Wxin");
    expect(runsText(runs)).toBe("Big Wxin");
    expect(runs.map((r) => [r.text, r.style.fontWeight])).toEqual([["Big ", undefined], ["Wxin", 700]]);
    const e = editRuns([{ text: "a😀b", style: { fontWeight: 700 } }], "a😀😀b");
    expect(runsText(e)).toBe("a😀😀b");
    const e2 = editRuns([{ text: "😀", style: { fontWeight: 700 } }, { text: "😁", style: {} }], "😀😂");
    expect(runsText(e2)).toBe("😀😂");
    expect(e2.every((r) => !/[\uD800-\uDBFF]$/.test(r.text) && !/^[\uDC00-\uDFFF]/.test(r.text))).toBe(true);
  });
  it("layout: empty/newlines/long word/huge", () => {
    const l = layoutRichText([{ text: "\n\n", style: {} }], base, measure as never);
    expect(l.lines.length).toBe(3);
    const long = layoutRichText([{ text: "x".repeat(200), style: {} }], base, measure as never, 50);
    expect(long.lines.every((ln) => ln.width <= 50 + 1e-6)).toBe(true);
    const t = performance.now();
    layoutRichText(Array.from({ length: 2000 }, (_, i) => ({ text: "word ", style: i % 2 ? { fontSize: 20 } : {} })), base, measure as never, 400);
    expect(performance.now() - t).toBeLessThan(1500);
  });
  it("parse junk", () => {
    expect(parseRuns([{ text: "a", style: { fill: { type: "linear", stops: [] } } }, null, 5, { text: "" }])).toEqual([{ text: "a", style: {} }]);
    const c = { text: "a", runs: [{ text: "a", style: {} }] };
    expect("runs" in migrateTextClipRuns(c)).toBe(false);
    const old = { text: "a" };
    expect(migrateTextClipRuns(old)).toBe(old);
    expect(normalizeRuns([])).toEqual([]);
  });
  it("engine: runs mismatched with text, update w/ text only", () => {
    const eng = new TitleEngine();
    const clip = eng.createTextClip({ trackId: "t", startTime: 0, duration: 3, text: "Hello", runs: [{ text: "Hello", style: { fontWeight: 700 } }] } as never);
    const u = eng.updateTextClip(clip.id, { text: "Hello world" })!;
    expect(runsText(u.runs!)).toBe("Hello world");
    const u2 = eng.updateTextClip(clip.id, { runs: undefined })!;
    expect(u2.runs).toBeUndefined();
    eng.loadTextClips([{ ...u, runs: [{ text: "stale", style: { fontWeight: 700 } }] }]);
    const l = eng.getTextClip(clip.id)!;
    expect(runsText(l.runs ?? [])).toBe(l.runs ? "Hello world" : "");
  });
});
