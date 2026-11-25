import { describe, expect, it } from "vitest";
import {
  applyRunStyle,
  clipRuns,
  editRuns,
  isRichTextClip,
  migrateTextClipRuns,
  normalizeRuns,
  parseRuns,
  rangeRunStyle,
  resolveBackgroundBox,
  resolveRunStyle,
  resolveStrokes,
  runsForText,
  runsText,
  scaleRuns,
} from "./rich-text";
import { DEFAULT_TEXT_STYLE, type TextClip, type TextRun } from "./types";
import { TitleEngine } from "./title-engine";

const plain = (text: string): TextRun[] => [{ text, style: {} }];
const shape = (runs: readonly TextRun[]) => runs.map((r) => [r.text, r.style]);

describe("run model: apply style to a selection", () => {
  it("splits one run into three and keeps the text intact", () => {
    const runs = applyRunStyle(plain("Hello brave world"), 6, 11, { fontWeight: 700, color: "#ff0000" });
    expect(shape(runs)).toEqual([
      ["Hello ", {}],
      ["brave", { fontWeight: 700, color: "#ff0000" }],
      [" world", {}],
    ]);
    expect(runsText(runs)).toBe("Hello brave world");
  });

  it("merges back when the same style is applied to neighbours and when a patch is cleared", () => {
    let runs = applyRunStyle(plain("abcdef"), 0, 3, { fontStyle: "italic" });
    runs = applyRunStyle(runs, 3, 6, { fontStyle: "italic" });
    expect(shape(runs)).toEqual([["abcdef", { fontStyle: "italic" }]]);
    runs = applyRunStyle(runs, 2, 4, { fontStyle: undefined });
    expect(shape(runs)).toEqual([["ab", { fontStyle: "italic" }], ["cd", {}], ["ef", { fontStyle: "italic" }]]);
    runs = applyRunStyle(runs, 0, 6, { fontStyle: undefined });
    expect(shape(runs)).toEqual([["abcdef", {}]]);
  });

  it("layers patches over existing overrides and ignores empty or reversed-out-of-range selections", () => {
    let runs = applyRunStyle(plain("abcd"), 0, 2, { color: "#111111" });
    runs = applyRunStyle(runs, 1, 3, { underline: true });
    expect(shape(runs)).toEqual([
      ["a", { color: "#111111" }],
      ["b", { color: "#111111", underline: true }],
      ["c", { underline: true }],
      ["d", {}],
    ]);
    expect(applyRunStyle(runs, 2, 2, { color: "#000" })).toEqual(runs);
    expect(runsText(applyRunStyle(runs, 3, 99, { smallCaps: true }))).toBe("abcd");
    expect(applyRunStyle(plain("abcd"), 3, 1, { tabularFigures: true })).toEqual(applyRunStyle(plain("abcd"), 1, 3, { tabularFigures: true }));
  });

  it("reports mixed and shared values over a range", () => {
    const runs = applyRunStyle(plain("abcdef"), 2, 4, { fontSize: 80 });
    expect(rangeRunStyle(runs, 2, 4).fontSize).toBe(80);
    expect(rangeRunStyle(runs, 0, 4).fontSize).toBe("mixed");
    expect(rangeRunStyle(runs, 0, 2).fontSize).toBeUndefined();
    // a caret takes the style of the character before it
    expect(rangeRunStyle(runs, 3, 3).fontSize).toBe(80);
  });
});

describe("run model: split and merge on edit", () => {
  const styled = applyRunStyle(plain("Hello world"), 6, 11, { fontWeight: 900 });

  it("typing inside a run extends that run", () => {
    expect(shape(editRuns(styled, "Hello wooorld"))).toEqual([["Hello ", {}], ["wooorld", { fontWeight: 900 }]]);
  });

  it("typing at a boundary inherits the style before the caret", () => {
    expect(shape(editRuns(styled, "Hello, world"))).toEqual([["Hello, ", {}], ["world", { fontWeight: 900 }]]);
    expect(shape(editRuns(styled, "Hello worldX"))).toEqual([["Hello ", {}], ["worldX", { fontWeight: 900 }]]);
  });

  it("typing at the very start takes the first run's style", () => {
    const bold = applyRunStyle(plain("abc"), 0, 3, { fontWeight: 700 });
    expect(shape(editRuns(bold, "Xabc"))).toEqual([["Xabc", { fontWeight: 700 }]]);
  });

  it("deleting a whole styled run merges the neighbours", () => {
    const runs = applyRunStyle(plain("abXYcd"), 2, 4, { color: "#f00" });
    expect(shape(editRuns(runs, "abcd"))).toEqual([["abcd", {}]]);
  });

  it("a replacement spanning two runs keeps the surrounding styles", () => {
    const runs = applyRunStyle(applyRunStyle(plain("aaaabbbb"), 0, 4, { color: "#111" }), 4, 8, { color: "#222" });
    expect(shape(editRuns(runs, "aaZZbb"))).toEqual([["aaZZ", { color: "#111" }], ["bb", { color: "#222" }]]);
    expect(runsText(editRuns(runs, "aaZZbb"))).toBe("aaZZbb");
  });

  it("clearing the text empties the runs and typing again starts plain", () => {
    expect(editRuns(styled, "")).toEqual([]);
    expect(editRuns([], "new")).toEqual(plain("new"));
  });

  it("reconciles runs whose text drifted from the clip text", () => {
    expect(runsText(runsForText("Hello brave world", styled))).toBe("Hello brave world");
    expect(runsForText("same", plain("same"))).toEqual(plain("same"));
  });

  it("TitleEngine re-flows runs when only the text is updated, and drops them on request", () => {
    const engine = new TitleEngine();
    const clip = engine.createTextClip({ trackId: "t", startTime: 0, text: "Hello world", runs: styled });
    const edited = engine.updateText(clip.id, "Hello big world")!;
    expect(runsText(edited.runs!)).toBe("Hello big world");
    expect(edited.runs!.find((r) => r.style.fontWeight === 900)?.text).toBe("world");
    const reset = engine.updateTextClip(clip.id, { runs: undefined })!;
    expect(reset.runs).toBeUndefined();
    expect(reset.text).toBe("Hello big world");
  });
});

describe("serialization and lazy migration", () => {
  it("round-trips through JSON unchanged", () => {
    const runs = applyRunStyle(plain("Price 12:30"), 6, 11, {
      tabularFigures: true,
      fill: { type: "linear", angle: 45, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] },
      baselineShift: 4, letterSpacing: 2, ligatures: false, smallCaps: true, fontFamily: "Inter", fontWeight: 600,
    });
    expect(parseRuns(JSON.parse(JSON.stringify(runs)))).toEqual(runs);
  });

  it("a clip without runs is a single plain run and takes the legacy renderer", () => {
    const clip = { text: "Old title", style: DEFAULT_TEXT_STYLE } as Pick<TextClip, "text" | "style" | "runs">;
    expect(clipRuns(clip)).toEqual(plain("Old title"));
    expect(isRichTextClip(clip)).toBe(false);
    expect(migrateTextClipRuns(clip)).toBe(clip);
    expect(resolveRunStyle(DEFAULT_TEXT_STYLE, {})).toMatchObject({ fontFamily: "Inter", fontSize: 48, baselineShift: 0, ligatures: true });
    expect(resolveStrokes(DEFAULT_TEXT_STYLE)).toEqual([{ color: "#111827", width: 2 }]);
    expect(resolveBackgroundBox(DEFAULT_TEXT_STYLE)).toBeUndefined();
  });

  it("drops runs that only restate the clip style and validates the rest", () => {
    const loaded = migrateTextClipRuns({ text: "abc", runs: [{ text: "abc", style: { fontSize: undefined } }] as TextRun[] });
    expect(loaded.runs).toBeUndefined();
    expect(parseRuns("nope")).toBeUndefined();
    expect(parseRuns([{ text: "ok", style: { fontSize: -4, color: 7, underline: "yes", fontWeight: 700, junk: 1 } }])).toEqual([{ text: "ok", style: { fontWeight: 700 } }]);
    expect(parseRuns([{ text: "x", style: { fill: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#000" }] } } }])).toEqual([{ text: "x", style: {} }]);
    const kept = migrateTextClipRuns({ text: "ab", runs: applyRunStyle(plain("ab"), 0, 1, { fontWeight: 700 }) });
    expect(kept.runs).toHaveLength(2);
  });

  it("loadTextClips migrates stored clips lazily", () => {
    const engine = new TitleEngine();
    const base = engine.createTextClip({ trackId: "t", startTime: 0, text: "abc" });
    const stored = { ...base, id: "stored", runs: [{ text: "abc", style: {} }] };
    engine.loadTextClips([stored]);
    expect(engine.getTextClip("stored")!.runs).toBeUndefined();
  });

  it("scales lengths and normalises adjacent equal runs", () => {
    const scaled = scaleRuns(applyRunStyle(plain("ab"), 0, 1, { fontSize: 10, letterSpacing: 1, baselineShift: 2, color: "#fff" }), 2);
    expect(scaled[0].style).toEqual({ fontSize: 20, letterSpacing: 2, baselineShift: 4, color: "#fff" });
    expect(normalizeRuns([{ text: "a", style: {} }, { text: "", style: { color: "#fff" } }, { text: "b", style: {} }])).toEqual(plain("ab"));
  });

  it("a gradient, extra stroke or box moves a clip onto the rich path", () => {
    const base = { text: "x", runs: undefined } as const;
    expect(isRichTextClip({ ...base, style: { ...DEFAULT_TEXT_STYLE, fill: { type: "radial", stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] } } })).toBe(true);
    expect(isRichTextClip({ ...base, style: { ...DEFAULT_TEXT_STYLE, strokes: [{ color: "#f00", width: 4 }, { color: "#00f", width: 8 }] } })).toBe(true);
    expect(isRichTextClip({ ...base, style: { ...DEFAULT_TEXT_STYLE, backgroundBox: { color: "#000", paddingX: 8, paddingY: 4, radius: 6 } } })).toBe(true);
  });
});
