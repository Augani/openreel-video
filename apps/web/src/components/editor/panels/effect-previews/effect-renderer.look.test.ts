import { describe, expect, it, vi } from "vitest";
import { EngineEffectRenderer } from "./effect-renderer";
import type { PreviewEffectDef } from "./preview-engine";

type RenderLook = (lane: unknown, modules: unknown, def: PreviewEffectDef, frame: unknown) => Promise<unknown>;

function setup() {
  const calls: string[] = [];
  const frame = { id: "frame", close: vi.fn() };
  const fxBitmap = { id: "fx", close: vi.fn() };
  const gradedBitmap = { id: "graded", close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(async (src: { id: string }) => (src === frame ? { id: "frame-copy", close: vi.fn() } : { id: `copy-of-${src.id}`, close: vi.fn() })));
  const lane = {
    effects: {
      applyEffectsToCanvas: vi.fn(async () => {
        calls.push("effects");
        return fxBitmap;
      }),
    },
    video: {
      gradeBitmap: vi.fn(async (_input: unknown, _grading: unknown) => {
        calls.push("grade");
        return gradedBitmap;
      }),
    },
  };
  const renderer = new EngineEffectRenderer();
  const renderLook = (renderer as unknown as { renderLook: RenderLook }).renderLook.bind(renderer);
  return { calls, frame, fxBitmap, gradedBitmap, lane, run: (def: PreviewEffectDef) => renderLook(lane, { VideoEngine: class {} }, def, frame) };
}

describe("look cards render like a clip renders: effects first, then the grade", () => {
  it("runs the effect chain, then grades its result (a preset on a graded clip)", async () => {
    const t = setup();
    const out = await t.run({
      id: "x",
      kind: "look",
      type: "filter-preset",
      effects: [{ type: "contrast", params: { value: 1.2 } }],
      grading: { temperature: 10 },
    });
    expect(t.calls).toEqual(["effects", "grade"]);
    // The grade sees the effects' output, not the raw frame.
    expect(t.lane.video.gradeBitmap.mock.calls[0][0]).toMatchObject({ id: "copy-of-fx" });
    expect(out).toBe(t.gradedBitmap);
    vi.unstubAllGlobals();
  });

  it("grades the raw frame when there are no effects, and copies the frame for a neutral card", async () => {
    const t = setup();
    await t.run({ id: "g", kind: "look", type: "lut-look", grading: { temperature: 10 } });
    expect(t.calls).toEqual(["grade"]);
    expect(t.lane.video.gradeBitmap.mock.calls[0][0]).toBe(t.frame);
    const neutral = (await setup().run({ id: "n", kind: "look", type: "current" })) as { id: string };
    expect(neutral.id).toBe("frame-copy");
    vi.unstubAllGlobals();
  });
});
