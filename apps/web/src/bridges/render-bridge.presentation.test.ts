import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedFrame } from "@openreel/core";
import { RenderBridge } from "./render-bridge";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  engine: vi.fn(),
  project: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("../stores/engine-store", () => ({
  useEngineStore: { getState: mocks.engine, setState: mocks.publish },
}));
vi.mock("../stores/project-store", () => ({
  useProjectStore: { getState: mocks.project },
}));
vi.mock("@openreel/core", async (original) => ({
  ...(await original<typeof import("@openreel/core")>()),
  getVideoEffectsEngine: () => ({}),
  createTransitionEngine: () => ({}),
}));

let bridge: RenderBridge;
let ctx: {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.render.mockReset();
  mocks.engine.mockReturnValue({
    initialized: true,
    videoEngine: { renderFrame: mocks.render },
  });
  mocks.project.mockReturnValue({
    project: { settings: { width: 1920, height: 1080 } },
  });
  bridge = new RenderBridge();
  await bridge.initialize();
  ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  bridge.setCanvas({
    width: 640,
    height: 360,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement);
});
const frame = (): RenderedFrame => ({
  image: { close: vi.fn() } as unknown as ImageBitmap,
  timestamp: 2,
  width: 1920,
  height: 1080,
});

describe("render-bridge presentation ownership", () => {
  it("does not begin an already obsolete frame", async () => {
    expect(await bridge.renderFrame(2, () => false)).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("releases a frame that becomes obsolete without painting it or replacing the current engine frame", async () => {
    let complete!: (frame: RenderedFrame) => void;
    mocks.render.mockReturnValue(
      new Promise<RenderedFrame>((resolve) => {
        complete = resolve;
      }),
    );
    let current = true;
    const pending = bridge.renderFrame(2, () => current);
    current = false;
    const rendered = frame();
    complete(rendered);
    expect(await pending).toBeNull();
    expect(rendered.image.close).toHaveBeenCalledOnce();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("preserves ordinary compositing and engine publication for a current frame", async () => {
    const rendered = frame();
    mocks.render.mockResolvedValue(rendered);
    expect(await bridge.renderFrame(2, () => true)).toBe(rendered);
    expect(ctx.drawImage).toHaveBeenCalledWith(rendered.image, 0, 0, 640, 360);
    expect(mocks.publish).toHaveBeenCalledWith({ currentFrame: rendered });
    expect(rendered.image.close).not.toHaveBeenCalled();
  });
});
