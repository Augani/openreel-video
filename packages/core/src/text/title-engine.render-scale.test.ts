import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleEngine } from "./title-engine";

describe("cached text measurements", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("restores ordinary tracking after measuring a spaced title", () => {
    const ctx = {
      letterSpacing: "0px",
      measureText(text: string) {
        return { width: text.length * 10 + Math.max(0, text.length - 1) * Number.parseFloat(this.letterSpacing) };
      },
    };
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return ctx; }
    });
    const engine = new TitleEngine();
    const spaced = engine.createTextClip({ trackId: "titles", startTime: 0, text: "ABCD", style: { letterSpacing: 4 } });
    const ordinary = engine.createTextClip({ trackId: "titles", startTime: 0, text: "ABCD", style: { letterSpacing: 0 } });
    expect(engine.measureText(spaced.text, spaced.style).width).toBe(52);
    expect(engine.measureText(ordinary.text, ordinary.style).width).toBe(40);
    expect(engine.measureText(spaced.text, spaced.style).width).toBe(52);
    expect(engine.measureText(ordinary.text, ordinary.style).width).toBe(40);
  });
});

describe("caption wrapping", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function setup() {
    const ctx = {
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 10 })),
      fillRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
    };
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(readonly width: number, readonly height: number) {}
      getContext() { return ctx; }
    });
    return { engine: new TitleEngine(), ctx };
  }

  it("draws the measured wrapped lines at the same breaks in preview and export", () => {
    const { engine, ctx } = setup();
    const clip = engine.createTextClip({
      trackId: "captions", startTime: 0,
      text: "Captions em português: ação, criação e precisão.",
      metadata: { captionSource: "srt" },
    });
    const exported = engine.renderText(clip, 360, 640);
    const exportLines = ctx.fillText.mock.calls.map(([text]) => text);
    ctx.fillText.mockClear();
    const previewed = engine.renderText(clip, 180, 320, 0, { x: 0.5, y: 0.5 });

    expect(exportLines).toEqual(["Captions em português: ação,", "criação e precisão."]);
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(exportLines);
    expect(previewed.textMetrics).toEqual(exported.textMetrics);
    expect(exported.textMetrics.width + 20).toBeLessThanOrEqual(360 * 0.9);
  });

  it("preserves explicit and empty lines and contains long unbroken words", () => {
    const { engine, ctx } = setup();
    const clip = engine.createTextClip({
      trackId: "captions", startTime: 0,
      text: "Primeira linha\n\ncriaçãocriaçãocriaçãocriaçãocriaçãocriação",
      metadata: { captionSource: "srt" },
    });
    const result = engine.renderText(clip, 360, 640);
    expect(result.textMetrics.lines[0].text).toBe("Primeira linha");
    expect(result.textMetrics.lines[1].text).toBe("");
    expect(result.textMetrics.lines.slice(2).map((line) => line.text).join("")).toBe(clip.text.split("\n")[2]);
    expect(result.textMetrics.lines.every((line) => line.width + 20 <= 360 * 0.9)).toBe(true);
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(result.textMetrics.lines.map((line) => line.text));
  });

  it("keeps manually laid out titles unchanged", () => {
    const { engine, ctx } = setup();
    const clip = engine.createTextClip({
      trackId: "titles", startTime: 0,
      text: "A manually arranged title that extends beyond the frame",
    });
    engine.renderText(clip, 360, 640);
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual([clip.text]);
  });
});
