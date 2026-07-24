import { describe, expect, it } from "vitest";
import { importSvgAsMotionComposition } from "./svg-importer";

describe("svg motion importer", () => {
  it("converts common SVG elements into editable motion layers", () => {
    const composition = importSvgAsMotionComposition(
      `<svg width="400" height="240" viewBox="0 0 400 240">
        <rect id="card" x="40" y="30" width="200" height="100" rx="16" fill="#111827" />
        <circle id="dot" cx="310" cy="80" r="32" style="fill: #14b8a6; stroke: #ffffff; stroke-width: 4" />
        <text id="label" x="200" y="190" font-size="32" fill="#ffffff" text-anchor="middle">Launch &amp; grow</text>
      </svg>`,
      { name: "Logo Import", duration: 4 },
    );

    expect(composition.name).toBe("Logo Import");
    expect(composition.width).toBe(400);
    expect(composition.height).toBe(240);
    expect(composition.duration).toBe(4);
    expect(composition.assets).toHaveLength(1);
    expect(composition.assets[0]).toMatchObject({
      type: "svg",
      name: "Logo Import",
    });

    const card = composition.layers.find((layer) => layer.name === "card");
    expect(card).toMatchObject({
      type: "shape",
      shapeType: "rectangle",
      width: 200,
      height: 100,
      transform: { position: { x: 140, y: 80 } },
    });
    expect(card?.keyframes).toHaveLength(2);

    const dot = composition.layers.find((layer) => layer.name === "dot");
    expect(dot).toMatchObject({
      type: "shape",
      shapeType: "ellipse",
      width: 64,
      height: 64,
      transform: { position: { x: 310, y: 80 } },
      style: {
        fill: { color: "#14b8a6" },
        stroke: { color: "#ffffff", width: 4 },
      },
    });

    const label = composition.layers.find((layer) => layer.name === "label");
    expect(label).toMatchObject({
      type: "text",
      text: "Launch & grow",
      transform: { position: { x: 200, y: 190 } },
      style: { fontSize: 32, color: "#ffffff" },
    });
  });

  it("scales viewBox coordinates when target dimensions are supplied", () => {
    const composition = importSvgAsMotionComposition(
      `<svg viewBox="0 0 100 50">
        <rect id="scaled" x="10" y="5" width="20" height="10" fill="#f59e0b" />
      </svg>`,
      { width: 200, height: 100 },
    );

    const scaled = composition.layers[0];
    expect(scaled).toMatchObject({
      width: 40,
      height: 20,
      transform: { position: { x: 40, y: 20 } },
    });
  });

  it("imports path-only SVG files as editable path layers", () => {
    const composition = importSvgAsMotionComposition(
      `<svg width="200" height="100"><path id="mark" d="M0 0 L100 0 L50 100 Z" fill="#f59e0b" /></svg>`,
    );

    expect(composition.layers).toHaveLength(1);
    expect(composition.layers[0]).toMatchObject({
      type: "shape",
      name: "mark",
      shapeType: "path",
      width: 100,
      height: 100,
      transform: { position: { x: 50, y: 50 } },
      pathData: "M -50 -50 L 50 -50 L 0 50 L -50 -50",
    });
  });

  it("imports polygon and line elements as path layers", () => {
    const composition = importSvgAsMotionComposition(
      `<svg width="200" height="200" viewBox="0 0 200 200">
        <polygon id="tri" points="100,20 180,180 20,180" fill="#22c55e" />
        <line id="rule" x1="20" y1="100" x2="180" y2="100" stroke="#ffffff" stroke-width="4" />
      </svg>`,
    );

    const triangle = composition.layers.find((layer) => layer.name === "tri");
    expect(triangle).toMatchObject({
      type: "shape",
      shapeType: "path",
      pathClosed: true,
    });
    expect((triangle as { pathData?: string }).pathData).toContain("L");
    expect((triangle as { pathData?: string }).pathData?.split("L").length).toBeGreaterThan(2);
    expect(triangle).toMatchObject({ transform: { position: { x: 100, y: 100 } } });

    const line = composition.layers.find((layer) => layer.name === "rule");
    expect(line).toMatchObject({
      type: "shape",
      shapeType: "path",
      pathClosed: false,
      transform: { position: { x: 100, y: 100 } },
      width: 160,
    });
  });

  it("applies group transforms to child elements", () => {
    const composition = importSvgAsMotionComposition(
      `<svg width="200" height="200" viewBox="0 0 200 200">
        <g transform="translate(50 30) scale(2)">
          <rect id="inner" x="0" y="0" width="20" height="10" fill="#3b82f6" />
        </g>
      </svg>`,
    );

    const inner = composition.layers.find((layer) => layer.name === "inner");
    expect(inner).toMatchObject({
      type: "shape",
      shapeType: "rectangle",
      width: 40,
      height: 20,
      transform: { position: { x: 70, y: 40 } },
    });
  });

  it("imports gradient fills into the shape style", () => {
    const composition = importSvgAsMotionComposition(
      `<svg width="200" height="200" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#ff0000" />
            <stop offset="100%" stop-color="#0000ff" />
          </linearGradient>
        </defs>
        <rect id="grad-box" x="20" y="20" width="100" height="60" fill="url(#grad)" />
      </svg>`,
    );

    const box = composition.layers.find((layer) => layer.name === "grad-box");
    expect(box).toMatchObject({
      type: "shape",
      style: {
        fill: {
          type: "gradient",
          gradient: {
            type: "linear",
            stops: [
              { offset: 0, color: "#ff0000" },
              { offset: 1, color: "#0000ff" },
            ],
          },
        },
      },
    });
  });
});
