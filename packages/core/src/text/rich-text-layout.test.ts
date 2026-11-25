import { describe, expect, it, vi, afterEach } from "vitest";
import { applyRunStyle } from "./rich-text";
import { layoutRichText, type RunMeasurer } from "./rich-text-layout";
import { blockBounds, blockTop, createFillPaint, drawRichText, lineStartX } from "./rich-text-render";
import { DEFAULT_TEXT_STYLE, type TextRun, type TextStyle } from "./types";
import { TitleEngine } from "./title-engine";

// Every glyph is half an em wide; tracking is added per character, like canvas letterSpacing.
const measure: RunMeasurer = (text, style) => ({
  width: Array.from(text).length * (style.fontSize * 0.5 + style.letterSpacing),
  ascent: style.fontSize * 0.8,
  descent: style.fontSize * 0.2,
});
const base: TextStyle = { ...DEFAULT_TEXT_STYLE, fontSize: 20, lineHeight: 1.5, letterSpacing: 0, textAlign: "left" };
const plain = (text: string): TextRun[] => [{ text, style: {} }];

describe("layout: line breaking with mixed sizes", () => {
  it("breaks where the wider (larger) words no longer fit", () => {
    // "aaa bbb ccc": 10px per char at size 20 -> a word is 30px; big runs are 20px per char -> 60px.
    const runs = applyRunStyle(plain("aaa bbb ccc"), 4, 7, { fontSize: 40 });
    const layout = layoutRichText(runs, base, measure, 99);
    expect(layout.lines.map((l) => l.text)).toEqual(["aaa", "bbb", "ccc"]);
    // 30 + space(10) + 60 = 100 fits exactly: the first two share a line at width 100.
    expect(layoutRichText(runs, base, measure, 100).lines.map((l) => l.text)).toEqual(["aaa bbb", "ccc"]);
    expect(layoutRichText(plain("aaa bbb ccc"), base, measure, 110).lines.map((l) => l.text)).toEqual(["aaa bbb ccc"]);
  });

  it("sizes each line by its largest run and sits all runs on one baseline", () => {
    const runs = applyRunStyle(plain("ab\ncd"), 0, 2, { fontSize: 40 });
    const { lines, height } = layoutRichText(runs, base, measure);
    expect(lines.map((l) => l.height)).toEqual([40 * 1.5, 20 * 1.5]);
    expect(height).toBe(90);
    expect(lines[1].top).toBe(60);
    // ascent 32 + descent 8 centred in 60 -> baseline at 10 + 32
    expect(lines[0].baseline).toBeCloseTo(42);
    const mixed = layoutRichText(applyRunStyle(plain("ab"), 1, 2, { fontSize: 40 }), base, measure);
    expect(mixed.lines[0].segments.map((s) => s.style.fontSize)).toEqual([20, 40]);
    expect(mixed.lines[0].height).toBe(60);
  });

  it("splits a word longer than the width and keeps hard breaks and blank lines", () => {
    expect(layoutRichText(plain("abcdefghij"), base, measure, 40).lines.map((l) => l.text)).toEqual(["abcd", "efgh", "ij"]);
    expect(layoutRichText(plain("a\n\nb"), base, measure, 100).lines.map((l) => l.text)).toEqual(["a", "", "b"]);
    expect(layoutRichText([], base, measure).lines).toHaveLength(1);
  });

  it("records where each segment starts in the text for character animation", () => {
    const runs = applyRunStyle(plain("ab cd"), 3, 5, { color: "#f00" });
    const seg = layoutRichText(runs, base, measure).lines[0].segments;
    expect(seg.map((s) => [s.text, s.start, s.x])).toEqual([["ab ", 0, 0], ["cd", 3, 30]]);
  });
});

describe("layout: tracking and kerning", () => {
  it("run tracking widens only that run", () => {
    const runs = applyRunStyle(plain("abcd"), 2, 4, { letterSpacing: 5 });
    const [a, b] = layoutRichText(runs, base, measure).lines[0].segments;
    expect([a.width, b.width]).toEqual([20, 30]);
    expect(b.x).toBe(20);
  });

  it("tracking changes where lines break", () => {
    const tight = layoutRichText(plain("abc def"), base, measure, 70).lines.map((l) => l.text);
    const tracked = layoutRichText(applyRunStyle(plain("abc def"), 0, 7, { letterSpacing: 4 }), base, measure, 70).lines.map((l) => l.text);
    expect(tight).toEqual(["abc def"]);
    expect(tracked).toEqual(["abc", "def"]);
  });
});

describe("layout: baseline shift", () => {
  it("raises a run above the baseline and grows the line", () => {
    const flat = layoutRichText(plain("ab"), base, measure).lines[0];
    const shifted = layoutRichText(applyRunStyle(plain("ab"), 1, 2, { baselineShift: 12 }), base, measure).lines[0];
    expect(shifted.segments[1].style.baselineShift).toBe(12);
    expect(shifted.height).toBe(flat.height);
    // ascent grows 16 -> 28: the baseline moves down inside the same box
    expect(shifted.baseline).toBeGreaterThan(flat.baseline);
    const lowered = layoutRichText(applyRunStyle(plain("ab"), 1, 2, { baselineShift: -6 }), base, measure).lines[0];
    expect(lowered.baseline).toBeLessThan(shifted.baseline);
  });
});

describe("block bounds and alignment", () => {
  it("aligns lines around the origin like the plain renderer", () => {
    const layout = layoutRichText(plain("aaaa\nbb"), { ...base, textAlign: "center" }, measure);
    expect(layout.lines.map((l) => lineStartX(l, "center"))).toEqual([-20, -10]);
    expect(lineStartX(layout.lines[0], "right")).toBe(-40);
    expect(blockTop(layout, "middle")).toBe(-layout.height / 2);
    const b = blockBounds(layout, { ...base, textAlign: "center" });
    expect([b.left, b.right, b.bottom - b.top]).toEqual([-20, 20, layout.height]);
  });
});

describe("paint", () => {
  function fakeCtx() {
    const gradients: { kind: string; args: number[]; stops: [number, string][] }[] = [];
    return {
      gradients,
      createLinearGradient: (...args: number[]) => { const g = { kind: "linear", args, stops: [] as [number, string][], addColorStop(o: number, c: string) { g.stops.push([o, c]); } }; gradients.push(g); return g; },
      createRadialGradient: (...args: number[]) => { const g = { kind: "radial", args, stops: [] as [number, string][], addColorStop(o: number, c: string) { g.stops.push([o, c]); } }; gradients.push(g); return g; },
    };
  }
  const bounds = { left: -50, right: 50, top: -20, bottom: 20 };

  it("spans a horizontal linear gradient across the whole block", () => {
    const ctx = fakeCtx();
    createFillPaint(ctx as never, { type: "linear", angle: 0, stops: [{ offset: 1, color: "#00f" }, { offset: 0, color: "#f00" }] }, bounds);
    expect(ctx.gradients[0].args.map((n) => Math.round(n))).toEqual([-50, 0, 50, 0]);
    expect(ctx.gradients[0].stops).toEqual([[0, "#f00"], [1, "#00f"]]);
  });

  it("keeps a diagonal gradient covering the corners and follows a moved glyph origin", () => {
    const ctx = fakeCtx();
    createFillPaint(ctx as never, { type: "linear", angle: 90, stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] }, bounds, { x: 10, y: 5 });
    expect(ctx.gradients[0].args.map((n) => Math.round(n))).toEqual([-10, -25, -10, 15]);
    createFillPaint(ctx as never, { type: "radial", stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] }, bounds);
    expect(ctx.gradients[1].kind).toBe("radial");
    expect(createFillPaint(ctx as never, { type: "solid", color: "#123456" }, bounds)).toBe("#123456");
  });
});

describe("draw order", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function recordingCtx() {
    const log: string[] = [];
    const ctx: Record<string, unknown> = {
      save: () => log.push("save"), restore: () => log.push("restore"),
      beginPath: vi.fn(), rect: () => log.push("rect"), fill: () => log.push("boxfill"), fillRect: () => log.push("fillRect"),
      fillText: (t: string) => log.push(`fill:${t}:${String(ctx.fillStyle)}:${String(ctx.shadowColor)}`),
      strokeText: (t: string) => log.push(`stroke:${t}:${String(ctx.strokeStyle)}:${ctx.lineWidth}:${String(ctx.shadowColor)}`),
      measureText: (t: string) => ({ width: Array.from(t).length * 10 }),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
    };
    return { ctx, log };
  }

  it("paints the box, then strokes behind, the fill, then strokes over; only the first pass casts the shadow", () => {
    const { ctx, log } = recordingCtx();
    const style: TextStyle = {
      ...base, shadowColor: "#000000", shadowBlur: 4,
      backgroundBox: { color: "#222", paddingX: 8, paddingY: 4, radius: 0 },
      strokes: [{ color: "#f00", width: 8 }, { color: "#00f", width: 3, position: "over" }, { color: "#0f0", width: 2 }],
    };
    const layout = layoutRichText(plain("ab"), style, (t) => ({ width: Array.from(t).length * 10, ascent: 16, descent: 4 }));
    drawRichText(ctx as never, { layout, style, opacity: 1 });
    const text = log.filter((l) => /^(fill|stroke):/.test(l));
    expect(text).toEqual([
      "stroke:ab:#f00:8:#000000", "stroke:ab:#0f0:2:transparent", "fill:ab:#ffffff:transparent", "stroke:ab:#00f:3:transparent",
    ]);
    expect(log.indexOf("boxfill")).toBeLessThan(log.findIndex((l) => l.startsWith("stroke")));
  });

  it("TitleEngine.renderText goes through the same layout for preview and export contexts", () => {
    const { ctx } = recordingCtx();
    vi.stubGlobal("OffscreenCanvas", class { constructor(readonly width: number, readonly height: number) {} getContext() { return ctx; } });
    ctx.clearRect = vi.fn();
    const engine = new TitleEngine();
    const clip = engine.createTextClip({
      trackId: "t", startTime: 0, text: "Hello world",
      runs: applyRunStyle(plain("Hello world"), 6, 11, { fontWeight: 900, color: "#ff0000" }),
    });
    const a = engine.renderText(clip, 400, 200, 0);
    const b = engine.renderText(clip, 400, 200, 0);
    expect(a.textMetrics).toEqual(b.textMetrics);
    expect(a.textMetrics.width).toBe(110);
    expect(a.textMetrics.lines.map((l) => l.text)).toEqual(["Hello world"]);
  });
});
