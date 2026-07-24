import { describe, expect, it } from "vitest";
import { importFigmaJsonAsMotionComposition } from "./figma-json-importer";

const makeFrame = () => ({
  type: "FRAME",
  name: "Hero Frame",
  absoluteBoundingBox: { x: 100, y: 200, width: 800, height: 600 },
  fills: [{ type: "SOLID", color: { r: 0.06, g: 0.09, b: 0.16, a: 1 } }],
  children: [
    {
      type: "RECTANGLE",
      name: "Card",
      absoluteBoundingBox: { x: 150, y: 260, width: 200, height: 120 },
      cornerRadius: 16,
      fills: [{ type: "SOLID", color: { r: 0.23, g: 0.51, b: 0.96, a: 1 } }],
    },
    {
      type: "TEXT",
      name: "Headline",
      characters: "Launch faster",
      absoluteBoundingBox: { x: 150, y: 420, width: 500, height: 80 },
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      style: {
        fontFamily: "Inter",
        fontSize: 64,
        fontWeight: 700,
        textAlignHorizontal: "LEFT",
        lineHeightPx: 76.8,
      },
    },
  ],
});

describe("figma json motion importer", () => {
  it("translates frame children into real shape and text layers", () => {
    const composition = importFigmaJsonAsMotionComposition(makeFrame(), "Figma Hero");

    expect(composition.name).toBe("Figma Hero");
    expect(composition.width).toBe(800);
    expect(composition.height).toBe(600);
    expect(composition.layers).toHaveLength(2);

    const card = composition.layers.find((layer) => layer.name === "Card");
    expect(card).toMatchObject({
      type: "shape",
      shapeType: "rectangle",
      width: 200,
      height: 120,
      transform: { position: { x: 150, y: 120 } },
      style: {
        fill: { color: "#3b82f5" },
        cornerRadius: 16,
      },
    });

    const headline = composition.layers.find((layer) => layer.name === "Headline");
    expect(headline).toMatchObject({
      type: "text",
      text: "Launch faster",
      transform: { position: { x: 300, y: 260 } },
      style: { fontFamily: "Inter", fontSize: 64, color: "#ffffff", align: "left" },
    });
    expect((headline as { style: { lineHeight?: number } }).style.lineHeight).toBeCloseTo(1.2, 5);
  });

  it("preserves the figma asset payload", () => {
    const frame = makeFrame();
    const composition = importFigmaJsonAsMotionComposition(frame);
    expect(composition.assets).toHaveLength(1);
    expect(composition.assets[0]).toMatchObject({ type: "figma", width: 800, height: 600 });
    expect(composition.assets[0].data).toBe(frame);
  });

  it("walks a document tree to find the first frame", () => {
    const document = {
      type: "DOCUMENT",
      children: [
        {
          type: "CANVAS",
          name: "Page 1",
          children: [makeFrame()],
        },
      ],
    };

    const composition = importFigmaJsonAsMotionComposition(document);
    expect(composition.width).toBe(800);
    expect(composition.height).toBe(600);
    expect(composition.layers).toHaveLength(2);
    expect(composition.layers.map((layer) => layer.type).sort()).toEqual([
      "shape",
      "text",
    ]);
  });

  it("falls back to a default canvas when no node tree is present", () => {
    const composition = importFigmaJsonAsMotionComposition({});
    expect(composition.width).toBe(1920);
    expect(composition.height).toBe(1080);
    expect(composition.layers).toHaveLength(0);
  });

  it("imports VECTOR nodes with fillGeometry as bezier path shapes", () => {
    const composition = importFigmaJsonAsMotionComposition({
      type: "FRAME",
      name: "Vector Frame",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 400 },
      children: [
        {
          type: "VECTOR",
          name: "Blob",
          absoluteBoundingBox: { x: 50, y: 50, width: 120, height: 120 },
          fills: [{ type: "SOLID", color: { r: 0.2, g: 0.6, b: 0.9, a: 1 } }],
          fillGeometry: [
            { path: "M 0 60 C 0 0 120 0 120 60 C 120 120 0 120 0 60 Z" },
          ],
        },
      ],
    });

    const vector = composition.layers.find(
      (layer) => layer.type === "shape" && layer.shapeType === "path",
    ) as { pathData?: string } | undefined;
    expect(vector).toBeDefined();
    expect(vector?.pathData ?? "").toMatch(/C/);
  });
});
