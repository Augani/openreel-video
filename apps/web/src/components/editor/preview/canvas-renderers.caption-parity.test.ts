import { describe, expect, it } from "vitest";
import { drawCaption } from "@openreel/core/captions/caption-layout";
import { renderSubtitleToCanvas } from "./canvas-renderers";

type Call = [string, unknown[]];

const makeCtx = () => {
  const calls: Call[] = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
  };
  const ctx = {
    save: rec("save"),
    restore: rec("restore"),
    beginPath: rec("beginPath"),
    fill: rec("fill"),
    fillRect: rec("fillRect"),
    roundRect: rec("roundRect"),
    fillText: rec("fillText"),
    strokeText: rec("strokeText"),
    measureText: (t: string) => ({ width: t.length * 10 }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe("static caption preview parity with export", () => {
  it("issues the same fillText and strokeText calls as drawCaption", () => {
    const subtitle = {
      id: "s1",
      text: "Hello world again",
      startTime: 0,
      endTime: 2,
      style: {
        fontSize: 40,
        strokeColor: "#000",
        strokeWidth: 3,
        shadowColor: "#111",
        shadowBlur: 4,
        position: "top",
        safeMargin: 0.1,
      },
    } as never;
    const preview = makeCtx();
    const exported = makeCtx();
    renderSubtitleToCanvas(preview.ctx, subtitle, 1280, 720);
    drawCaption(exported.ctx, subtitle, 1280, 720);
    const text = (calls: Call[]) =>
      calls.filter(([n]) => n === "fillText" || n === "strokeText");
    expect(text(preview.calls).length).toBeGreaterThan(0);
    expect(text(preview.calls)).toEqual(text(exported.calls));
    expect(text(preview.calls).some(([n]) => n === "strokeText")).toBe(true);
  });
});
