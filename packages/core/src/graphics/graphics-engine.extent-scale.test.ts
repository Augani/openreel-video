import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine } from "./graphics-engine";

const rects: Array<[number, number, number, number]> = [];

class MockContext {
  save = vi.fn();
  restore = vi.fn();
  translate = vi.fn();
  rotate = vi.fn();
  scale = vi.fn();
  beginPath = vi.fn();
  closePath = vi.fn();
  fill = vi.fn();
  stroke = vi.fn();
  rect = (x: number, y: number, w: number, h: number) => {
    rects.push([x, y, w, h]);
  };
  moveTo = vi.fn();
  lineTo = vi.fn();
  clearRect = vi.fn();
  setLineDash = vi.fn();
  globalAlpha = 1;
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
}

class MockCanvas {
  width = 0;
  height = 0;
  private context = new MockContext();
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return this.context;
  }
}

vi.stubGlobal("OffscreenCanvas", MockCanvas);
vi.stubGlobal("HTMLCanvasElement", class {});

const params = { shapeType: "rectangle" as const, width: 1920, height: 120 };

describe("shape extent", () => {
  let engine: GraphicsEngine;
  beforeEach(() => {
    engine = new GraphicsEngine();
    rects.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("draws a letterbox bar at its own pixel size, not the default 15% square", async () => {
    const bar = engine.createShape({ ...params, extent: { width: 1920, height: 120 } }, "t", 0, 5);
    await engine.renderGraphic(bar, 0, 1920, 1080);
    expect(rects.at(-1)).toEqual([-960, -60, 1920, 120]);
  });

  it("scales the extent with the canvas short side over 1080", async () => {
    const bar = engine.createShape({ ...params, extent: { width: 1920, height: 120 } }, "t", 0, 5);
    await engine.renderGraphic(bar, 0, 1280, 720);
    const [x, y, w, h] = rects.at(-1)!;
    expect(w).toBeCloseTo(1920 * (720 / 1080));
    expect(h).toBeCloseTo(120 * (720 / 1080));
    expect(x).toBeCloseTo(-w / 2);
    expect(y).toBeCloseTo(-h / 2);
  });

  it("still draws the default square for a shape without an extent", async () => {
    const plain = engine.createShape(params, "t", 0, 5);
    await engine.renderGraphic(plain, 0, 1920, 1080);
    const [, , w, h] = rects.at(-1)!;
    expect(w).toBeCloseTo(162);
    expect(h).toBeCloseTo(162);
  });
});
