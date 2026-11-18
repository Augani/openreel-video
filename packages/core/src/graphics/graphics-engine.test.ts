import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GraphicsEngine } from "./graphics-engine";
import type { EmphasisAnimation } from "./types";

class MockCanvasContext {
  save = vi.fn();
  restore = vi.fn();
  clearRect = vi.fn();
  fillRect = vi.fn();
  translate = vi.fn();
  rotate = vi.fn();
  scale = vi.fn();
  beginPath = vi.fn();
  closePath = vi.fn();
  fill = vi.fn();
  stroke = vi.fn();
  arc = vi.fn();
  moveTo = vi.fn();
  lineTo = vi.fn();
  ellipse = vi.fn();
  quadraticCurveTo = vi.fn();
  rect = vi.fn();
  createLinearGradient = vi.fn(() => ({
    addColorStop: vi.fn(),
  }));
  createRadialGradient = vi.fn(() => ({
    addColorStop: vi.fn(),
  }));
  setLineDash = vi.fn();
  drawImage = vi.fn();
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  lineDashOffset = 0;
  shadowColor = "";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  filter = "";
}

class MockCanvas {
  width = 1920;
  height = 1080;
  private ctx = new MockCanvasContext();
  getContext() {
    return this.ctx;
  }
}

vi.stubGlobal("OffscreenCanvas", MockCanvas);
vi.stubGlobal("HTMLCanvasElement", class {});

describe("GraphicsEngine", () => {
  let engine: GraphicsEngine;

  beforeEach(() => {
    engine = new GraphicsEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("shape creation and management", () => {
    it("should create a rectangle shape with correct properties", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);

      expect(clip.id).toBeDefined();
      expect(clip.id.length).toBeGreaterThan(0);
      expect(clip.shapeType).toBe("rectangle");
      expect(clip.trackId).toBe("track-1");
      expect(clip.startTime).toBe(0);
      expect(clip.duration).toBe(5);
      expect(clip.type).toBe("shape");
      expect(clip.transform).toBeDefined();
      expect(clip.transform.position).toBeDefined();
      expect(clip.transform.scale).toBeDefined();
      expect(clip.transform.rotation).toBeDefined();
      expect(clip.transform.opacity).toBeDefined();
      expect(clip.keyframes).toEqual([]);
    });

    it("should update shape clip properties", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.updateShapeClip(clip.id, {
        duration: 10,
        transform: {
          ...clip.transform,
          position: { x: 0.25, y: 0.75 },
        },
      });

      expect(updated?.duration).toBe(10);
      expect(updated?.transform.position).toEqual({ x: 0.25, y: 0.75 });
    });

    it("keeps the default tile unless an extent is authored, and stores the extent when it is", () => {
      expect(engine.createRectangle("t", 0, 5, 100, 50).extent).toBeUndefined();
      const sized = engine.createShape(
        { shapeType: "rectangle", width: 1920, height: 120, extent: { width: 1920, height: 120 } },
        "t",
        0,
        5,
      );
      expect(sized.extent).toEqual({ width: 1920, height: 120 });
    });

    it("draws an authored rectangle at its size, offset by the anchor, in 1080-line units", async () => {
      const bar = engine.createShape(
        { shapeType: "rectangle", width: 1920, height: 12, extent: { width: 1920, height: 12 } },
        "t",
        0,
        5,
      );
      const anchored = { ...bar, transform: { ...bar.transform, anchor: { x: 0, y: 0.5 } } };
      const rendered = await engine.renderGraphic(anchored, 0, 960, 540);
      const ctx = rendered.canvas.getContext("2d") as unknown as MockCanvasContext;
      // A 540-line frame scales 1920x12 reference pixels to 960x6; an anchor on the left edge starts the box at x = 0.
      expect(ctx.rect).toHaveBeenCalledTimes(1);
      const [x, y, w, h] = ctx.rect.mock.calls[0] as number[];
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(-3, 5);
      expect(w).toBeCloseTo(960, 5);
      expect(h).toBeCloseTo(6, 5);
    });

    it("should delete shape clip", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const deleteResult = engine.deleteShapeClip(clip.id);

      expect(deleteResult).toBe(true);
      const retrieved = engine.getShapeClip(clip.id);
      expect(retrieved).toBeUndefined();
    });

  });

  describe("emphasis animation configuration", () => {
    it("should set emphasis animation on shape clip", () => {
      const clip = engine.createRectangle("track-1", 0, 10, 100, 100);
      const animation: EmphasisAnimation = {
        type: "pulse",
        speed: 1,
        intensity: 1,
        loop: true,
      };

      const updated = engine.updateShapeClip(clip.id, {
        emphasisAnimation: animation,
      });

      expect(updated?.emphasisAnimation).toEqual(animation);
    });

    it("should preserve emphasis animation when updating other properties", () => {
      const clip = engine.createRectangle("track-1", 0, 10, 100, 100);
      const animation: EmphasisAnimation = {
        type: "pulse",
        speed: 2,
        intensity: 0.5,
        loop: false,
        startTime: 1,
        animationDuration: 5,
      };

      engine.updateShapeClip(clip.id, { emphasisAnimation: animation });
      const updated = engine.updateShapeClip(clip.id, { duration: 20 });

      expect(updated?.emphasisAnimation).toEqual(animation);
      expect(updated?.duration).toBe(20);
    });

    it("should support all emphasis animation types", () => {
      const animationTypes: EmphasisAnimation["type"][] = [
        "pulse",
        "shake",
        "bounce",
        "float",
        "spin",
        "flash",
        "heartbeat",
        "swing",
        "wobble",
        "jello",
        "rubber-band",
        "tada",
        "vibrate",
        "flicker",
        "glow",
        "breathe",
        "wave",
        "tilt",
        "zoom-pulse",
        "focus-zoom",
        "pan-left",
        "pan-right",
        "pan-up",
        "pan-down",
        "ken-burns",
        "none",
      ];

      for (const type of animationTypes) {
        const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
        const updated = engine.updateShapeClip(clip.id, {
          emphasisAnimation: {
            type,
            speed: 1,
            intensity: 1,
            loop: true,
          },
        });

        expect(updated?.emphasisAnimation?.type).toBe(type);
      }
    });

  });

  describe("rendering with emphasis animations", () => {
    it("should render shape with emphasis animation", async () => {
      const clip = engine.createRectangle("track-1", 0, 10, 100, 100);
      engine.updateShapeClip(clip.id, {
        emphasisAnimation: {
          type: "pulse",
          speed: 1,
          intensity: 1,
          loop: true,
        },
      });

      const updatedClip = engine.getShapeClip(clip.id)!;
      const result = await engine.renderGraphic(updatedClip, 0.5, 1920, 1080);

      expect(result.canvas).toBeDefined();
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it("should render shape to canvas", async () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const result = await engine.renderGraphic(clip, 0, 1920, 1080);

      expect(result.canvas).toBeDefined();
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it("should return empty canvas when opacity is 0", async () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      engine.updateShapeClip(clip.id, {
        transform: {
          ...clip.transform,
          opacity: 0,
        },
      });

      const updatedClip = engine.getShapeClip(clip.id)!;
      const result = await engine.renderGraphic(updatedClip, 0, 1920, 1080);

      expect(result.canvas).toBeDefined();
    });

  });

  describe("keyframe animations", () => {
    it("should add keyframe to shape clip", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.addKeyframe(clip, {
        id: "kf-1",
        time: 0,
        property: "position.x",
        value: 0.2,
        easing: "linear",
      });

      expect(updated.keyframes.length).toBe(1);
      expect(updated.keyframes[0].id).toBe("kf-1");
      expect(updated.keyframes[0].time).toBe(0);
      expect(updated.keyframes[0].property).toBe("position.x");
      expect(updated.keyframes[0].value).toBe(0.2);
      expect(updated.keyframes[0].easing).toBe("linear");
    });

    it("should remove keyframe", () => {
      let clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      clip = engine.addKeyframe(clip, {
        id: "kf-1",
        time: 0,
        property: "position.x",
        value: 0.2,
        easing: "linear",
      });

      clip = engine.removeKeyframe(clip, "kf-1");

      expect(clip.keyframes.length).toBe(0);
    });

    it("should remove only the specified keyframe", () => {
      let clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      clip = engine.addKeyframe(clip, {
        id: "kf-1",
        time: 0,
        property: "position.x",
        value: 0.2,
        easing: "linear",
      });
      clip = engine.addKeyframe(clip, {
        id: "kf-2",
        time: 5,
        property: "position.x",
        value: 0.8,
        easing: "linear",
      });

      clip = engine.removeKeyframe(clip, "kf-1");

      expect(clip.keyframes.length).toBe(1);
      expect(clip.keyframes[0].id).toBe("kf-2");
    });

  });

  describe("fill and stroke styles", () => {
    it("should update fill style", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.updateFill(clip, {
        type: "solid",
        color: "#FF0000",
        opacity: 0.8,
      });

      expect(updated.style.fill.color).toBe("#FF0000");
      expect(updated.style.fill.opacity).toBe(0.8);
      expect(updated.style.fill.type).toBe("solid");
    });

    it("should update gradient fill", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.updateFill(clip, {
        type: "gradient",
        opacity: 1,
        gradient: {
          type: "linear",
          angle: 45,
          stops: [
            { offset: 0, color: "#FF0000" },
            { offset: 1, color: "#0000FF" },
          ],
        },
      });

      expect(updated.style.fill.type).toBe("gradient");
      expect(updated.style.fill.gradient?.type).toBe("linear");
      expect(updated.style.fill.gradient?.angle).toBe(45);
      expect(updated.style.fill.gradient?.stops.length).toBe(2);
    });

  });

  describe("transform operations", () => {
    it("should update position", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.updateShapeClip(clip.id, {
        transform: {
          ...clip.transform,
          position: { x: 0.3, y: 0.7 },
        },
      });

      expect(updated?.transform.position).toEqual({ x: 0.3, y: 0.7 });
    });

  });

  describe("timing and duration operations", () => {
    it("should update start time", () => {
      const clip = engine.createRectangle("track-1", 0, 5, 100, 50);
      const updated = engine.updateShapeClip(clip.id, {
        startTime: 2.5,
      });

      expect(updated?.startTime).toBe(2.5);
    });

  });
});
