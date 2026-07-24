import { describe, expect, it } from "vitest";
import type { LottieAnimation, LottieLayer } from "../../types/lottie";
import { importLottieAsMotionComposition } from "./lottie-importer";

const baseTransform = {
  a: { a: 0, k: [0, 0] },
  p: { a: 0, k: [100, 80] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
};

const baseLayer = {
  ddd: 0,
  ind: 1,
  sr: 1,
  ao: 0,
  ip: 0,
  op: 60,
  st: 0,
  bm: 0,
  ks: baseTransform,
};

function makeLottie(layers: LottieLayer[]): LottieAnimation {
  return {
    v: "5.12.0",
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 240,
    nm: "Imported Logo",
    ddd: 0,
    assets: [],
    layers,
    markers: [{ tm: 15, cm: "Beat", dr: 10 }],
  };
}

describe("lottie motion importer", () => {
  it("converts solids, shape primitives, text, and markers into motion data", () => {
    const lottie = makeLottie([
      {
        ...baseLayer,
        ind: 1,
        ty: 1,
        nm: "Background Solid",
        sc: "#111827",
        sw: 400,
        sh: 240,
      },
      {
        ...baseLayer,
        ind: 2,
        ty: 4,
        nm: "Button Shape",
        ks: {
          ...baseTransform,
          o: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 15, s: [100] },
            ],
          },
        },
        shapes: [
          {
            ty: "rc",
            nm: "Button Rect",
            d: 1,
            s: { a: 0, k: [180, 70] },
            p: { a: 0, k: [20, 10] },
            r: { a: 0, k: 12 },
          },
          {
            ty: "fl",
            nm: "Fill",
            c: { a: 0, k: [0.08, 0.72, 0.65, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            bm: 0,
          },
        ],
      },
      {
        ...baseLayer,
        ind: 3,
        ty: 5,
        nm: "Title Text",
        t: {
          d: {
            k: [
              {
                t: 0,
                s: {
                  s: 42,
                  f: "Inter",
                  t: "Hello Lottie",
                  j: 1,
                  tr: 0,
                  lh: 48,
                  fc: [1, 1, 1],
                },
              },
            ],
          },
          p: {},
          m: { g: 1, a: { a: 0, k: [0, 0] } },
          a: [],
        },
      },
    ] as LottieLayer[]);

    const composition = importLottieAsMotionComposition(lottie);

    expect(composition.name).toBe("Imported Logo");
    expect(composition.duration).toBe(2);
    expect(composition.assets[0]).toMatchObject({
      type: "lottie",
      name: "Imported Logo",
      duration: 2,
    });
    expect(composition.markers).toEqual([
      expect.objectContaining({ time: 0.5, label: "Beat" }),
    ]);

    expect(composition.layers).toHaveLength(3);
    expect(composition.layers[0]).toMatchObject({
      type: "shape",
      name: "Background Solid",
      width: 400,
      height: 240,
      style: { fill: { color: "#111827" } },
    });
    expect(composition.layers[1]).toMatchObject({
      type: "shape",
      name: "Button Rect",
      width: 180,
      height: 70,
      transform: { position: { x: 120, y: 90 } },
      style: {
        fill: { color: "#14b8a6" },
        cornerRadius: 12,
      },
    });
    expect(composition.layers[1].keyframes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: "transform.opacity",
          time: 0,
          value: 0,
        }),
        expect.objectContaining({
          property: "transform.opacity",
          time: 0.5,
          value: 1,
        }),
      ]),
    );
    expect(composition.layers[2]).toMatchObject({
      type: "text",
      name: "Title Text",
      text: "Hello Lottie",
      style: { fontFamily: "Inter", fontSize: 42, color: "#ffffff" },
    });
  });

  it("converts bezier sh path shapes into shape layers with pathData", () => {
    const lottie = makeLottie([
      {
        ...baseLayer,
        ind: 1,
        ty: 4,
        nm: "Bezier Path",
        shapes: [
          {
            ty: "sh",
            nm: "Curve",
            ind: 0,
            ix: 1,
            ks: {
              a: 0,
              k: {
                c: true,
                v: [
                  [0, 0],
                  [100, 0],
                  [100, 100],
                  [0, 100],
                ],
                i: [
                  [0, 0],
                  [-20, 0],
                  [0, -20],
                  [20, 0],
                ],
                o: [
                  [20, 0],
                  [0, 20],
                  [-20, 0],
                  [0, -20],
                ],
              },
            },
          },
          {
            ty: "fl",
            nm: "Fill",
            c: { a: 0, k: [1, 0, 0, 1] },
            o: { a: 0, k: 100 },
            r: 1,
            bm: 0,
          },
        ],
      },
    ] as unknown as LottieLayer[]);

    const composition = importLottieAsMotionComposition(lottie);
    const pathLayer = composition.layers.find((layer) => layer.type === "shape");
    expect(pathLayer).toBeDefined();
    expect(pathLayer).toMatchObject({ shapeType: "path", pathClosed: true });
    const pathData = (pathLayer as { pathData?: string }).pathData ?? "";
    expect(pathData.length).toBeGreaterThan(0);
    expect(pathData).toMatch(/^M /);
    expect(pathData.split("C").length).toBeGreaterThan(1);
  });

  it("converts polystar sr shapes into star layers", () => {
    const lottie = makeLottie([
      {
        ...baseLayer,
        ind: 1,
        ty: 4,
        nm: "Star Shape",
        shapes: [
          {
            ty: "sr",
            nm: "Star",
            sy: { a: 0, k: 1 },
            pt: { a: 0, k: 6 },
            or: { a: 0, k: 80 },
            ir: { a: 0, k: 40 },
            p: { a: 0, k: [0, 0] },
          },
        ],
      },
    ] as unknown as LottieLayer[]);

    const composition = importLottieAsMotionComposition(lottie);
    const star = composition.layers.find((layer) => layer.type === "shape");
    expect(star).toMatchObject({
      shapeType: "star",
      width: 160,
      height: 160,
      style: { points: 6 },
    });
    expect((star as { style: { innerRadius?: number } }).style.innerRadius).toBeCloseTo(0.5, 5);
  });

  it("imports gradient fills as gradient shape styles", () => {
    const lottie = makeLottie([
      {
        ...baseLayer,
        ind: 1,
        ty: 4,
        nm: "Gradient Rect",
        shapes: [
          {
            ty: "rc",
            nm: "Rect",
            d: 1,
            s: { a: 0, k: [120, 80] },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 0 },
          },
          {
            ty: "gf",
            nm: "Gradient Fill",
            t: 1,
            g: {
              p: 2,
              k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] },
            },
          },
        ],
      },
    ] as unknown as LottieLayer[]);

    const composition = importLottieAsMotionComposition(lottie);
    const rect = composition.layers.find((layer) => layer.type === "shape");
    expect(rect).toMatchObject({
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

  it("imports image and precomp layers as placeholders instead of dropping them", () => {
    const lottie = makeLottie([
      {
        ...baseLayer,
        ind: 1,
        ty: 2,
        nm: "Photo",
        refId: "image_0",
      },
      {
        ...baseLayer,
        ind: 2,
        ty: 0,
        nm: "Nested Comp",
        refId: "comp_0",
        w: 320,
        h: 200,
      },
    ] as unknown as LottieLayer[]);

    const composition = importLottieAsMotionComposition(lottie);
    expect(composition.layers).toHaveLength(2);
    expect(composition.layers[0]).toMatchObject({ type: "shape", name: "Photo" });
    expect(composition.layers[1]).toMatchObject({
      type: "shape",
      name: "Nested Comp",
      width: 320,
      height: 200,
    });
  });
});
