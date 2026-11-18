import { describe, expect, it } from "vitest";
import { displayLayoutWidth } from "../sequence-par";
import { createTransformMatrix } from "./index";

type Pt = { x: number; y: number };
type Affine = readonly [number, number, number, number, number, number]; // a b c d e f like CanvasRenderingContext2D

const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

interface Layer {
  position: Pt;
  scale: Pt; // fit * user scale, as a fraction of the display frame
  rotation: number; // degrees
  anchor: Pt;
}

/** The Canvas2D / export draw sequence, literally: the reference the GPU matrix must reproduce. */
function canvas2dCorners(layer: Layer, W: number, H: number, par: number): Pt[] {
  const L = displayLayoutWidth(W, par);
  const sequencePar = L / W;
  let m: Affine = [1, 0, 0, 1, 0, 0];
  if (sequencePar !== 1) m = mul(m, [1 / sequencePar, 0, 0, 1, 0, 0]); // ctx.scale(1 / par, 1)
  m = mul(m, [1, 0, 0, 1, L / 2 + layer.position.x * sequencePar, H / 2 + layer.position.y]); // ctx.translate
  const t = (layer.rotation * Math.PI) / 180;
  m = mul(m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]); // ctx.rotate
  // ctx.scale(userScale) then draw a fit-sized rect: the product is `scale` x the display frame.
  const w = layer.scale.x * L;
  const h = layer.scale.y * H;
  const x0 = -w * layer.anchor.x;
  const y0 = -h * layer.anchor.y;
  // quad corners in the order TL, TR, BL, BR
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0, y: y0 + h },
    { x: x0 + w, y: y0 + h },
  ].map((p) => apply(m, p));
}

/** Push the quad's clip-space corners (+-1, +-1) through the GPU matrix and back to stored pixels (y down). */
function gpuCorners(layer: Layer, W: number, H: number, par: number): Pt[] {
  const g = createTransformMatrix(layer.position, layer.scale, layer.rotation, layer.anchor, W, H, par);
  const corners = [
    { x: -1, y: 1 }, // TL
    { x: 1, y: 1 }, // TR
    { x: -1, y: -1 }, // BL
    { x: 1, y: -1 }, // BR
  ];
  return corners.map((p) => {
    const cx = g[0] * p.x + g[4] * p.y + g[12];
    const cy = g[1] * p.x + g[5] * p.y + g[13];
    return { x: ((cx + 1) / 2) * W, y: ((1 - cy) / 2) * H };
  });
}

const PARS = [
  { name: "square", par: 1 },
  { name: "DV 0.9091", par: 10 / 11 },
  { name: "HDV 1.3333", par: 4 / 3 },
  { name: "anamorphic 2.0", par: 2 },
];
const W = 720;
const H = 480;

describe("GPU layer matrix in display space", () => {
  for (const { name, par } of PARS) {
    it(`matches the Canvas2D draw sequence at PAR ${name}`, () => {
      const layers: Layer[] = [
        { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
        { position: { x: 37, y: -21 }, scale: { x: 0.4, y: 0.6 }, rotation: 33, anchor: { x: 0.5, y: 0.5 } },
        { position: { x: -90, y: 55 }, scale: { x: 0.8, y: 0.3 }, rotation: -118, anchor: { x: 0.2, y: 0.9 } },
        { position: { x: 10, y: 10 }, scale: { x: 0.25, y: 0.25 }, rotation: 90, anchor: { x: 0, y: 0 } },
      ];
      for (const layer of layers) {
        const gpu = gpuCorners(layer, W, H, par);
        const ref = canvas2dCorners(layer, W, H, par);
        gpu.forEach((p, i) => {
          expect(p.x, `corner ${i} x`).toBeCloseTo(ref[i].x, 2);
          expect(p.y, `corner ${i} y`).toBeCloseTo(ref[i].y, 2);
        });
      }
    });

    it(`keeps a rotated layer rigid in display space (no shear) at PAR ${name}`, () => {
      // A layer that is a square on screen: its display size is S x S.
      const S = 200;
      const L = displayLayoutWidth(W, par);
      const layer: Layer = {
        position: { x: 0, y: 0 },
        scale: { x: S / L, y: S / H },
        rotation: 30,
        anchor: { x: 0.5, y: 0.5 },
      };
      // stored -> display: x * (L / W)
      const display = gpuCorners(layer, W, H, par).map((p) => ({ x: (p.x * L) / W, y: p.y }));
      const [tl, tr, bl, br] = display;
      const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
      expect(dist(tl, tr)).toBeCloseTo(S, 1);
      expect(dist(tl, bl)).toBeCloseTo(S, 1);
      expect(dist(tr, br)).toBeCloseTo(S, 1);
      // right angle at TL
      const dot = (tr.x - tl.x) * (bl.x - tl.x) + (tr.y - tl.y) * (bl.y - tl.y);
      expect(Math.abs(dot) / (S * S)).toBeLessThan(1e-3);
      // the diagonals of a square are equal
      expect(dist(tl, br)).toBeCloseTo(dist(tr, bl), 1);
    });
  }

  it("positions are stored pixels, y down: positive y moves the layer toward the bottom", () => {
    const base = gpuCorners({ position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, W, H, 1);
    const moved = gpuCorners({ position: { x: 30, y: 20 }, scale: { x: 0.5, y: 0.5 }, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, W, H, 1);
    expect(moved[0].x - base[0].x).toBeCloseTo(30, 3);
    expect(moved[0].y - base[0].y).toBeCloseTo(20, 3);
  });

  it("rotation is in degrees, clockwise on screen (like ctx.rotate)", () => {
    const upright = gpuCorners({ position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0, anchor: { x: 0.5, y: 0.5 } }, 400, 400, 1);
    const turned = gpuCorners({ position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 90, anchor: { x: 0.5, y: 0.5 } }, 400, 400, 1);
    // The top-left corner of an upright square goes to the top-right after a quarter turn clockwise.
    expect(turned[0].x).toBeCloseTo(upright[1].x, 3);
    expect(turned[0].y).toBeCloseTo(upright[1].y, 3);
  });

  it("treats an invalid PAR as square", () => {
    const layer: Layer = { position: { x: 5, y: 6 }, scale: { x: 0.5, y: 0.5 }, rotation: 20, anchor: { x: 0.5, y: 0.5 } };
    expect(Array.from(createTransformMatrix(layer.position, layer.scale, layer.rotation, layer.anchor, W, H, Number.NaN))).toEqual(
      Array.from(createTransformMatrix(layer.position, layer.scale, layer.rotation, layer.anchor, W, H, 1)),
    );
  });
});
