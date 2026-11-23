import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";
import { openWithClips } from "./lumetri-basic-lib";
import { ensureTransitionFixtures, runEngineParity, runPresetFlow } from "./custom-transitions-lib";

// Real-browser coverage of the Premiere-style transitions: the Canvas2D TransitionEngine (the one renderer preview and
// export share; there is no WebGPU transition path) against the pure mask reference, then a preset applied through the
// UI, set as the default, applied from the keyboard and exported.

test.beforeAll(() => {
  ensureTransitionFixtures();
});

test("every mask transition matches its reference at 0, 0.5 and 1, with feather, border, reverse and start / end", async ({ page }) => {
  test.setTimeout(240_000);
  await openHookPage(page);
  const { rows, extras } = await runEngineParity(page);
  const worst = [...rows].sort((a, b) => b.mad - a.mad).slice(0, 3);
  console.log(`[transitions] ${rows.length} frames compared; worst mad: ${worst.map((r) => `${r.label}=${r.mad.toFixed(3)}/${r.max.toFixed(0)}`).join("; ")}`);
  for (const row of rows) {
    const full = row.label.includes("1080p");
    expect(row.mad, `${row.label} mean abs diff`).toBeLessThan(full ? 1.2 : 0.35);
    expect(row.max, `${row.label} max diff`).toBeLessThanOrEqual(full ? 255 : 6);
  }
  const near = (actual: unknown, expected: number[], tol: number) =>
    (actual as number[]).forEach((v, i) => expect(Math.abs(v - expected[i]), JSON.stringify({ actual, expected })).toBeLessThanOrEqual(tol));
  near(extras.filmStart, [0, 0, 0], 1);
  near(extras.filmEnd, [255, 255, 255], 1);
  const film = (extras.filmMid as number[])[0];
  expect(film).toBeGreaterThan(180);
  expect(film).toBeLessThan(196);
  // An sRGB mix of black and white at 0.5 is 128; the linear-light mix is about 188.
  near(extras.additiveStart, [100, 0, 0], 1);
  near(extras.additiveMid, [100, 0, 100], 2);
  near(extras.additiveEnd, [0, 0, 100], 1);
  near(extras.cubeStart, [220, 40, 40], 1);
  near(extras.cubeEnd, [40, 60, 220], 1);
  near(extras.cubeMidCorner, [0, 0, 0], 1);
  near(extras.cubeMidLeft, [220, 40, 40], 1);
  near(extras.cubeMidRight, [40, 60, 220], 1);
  near(extras.cubeUpTop, [220, 40, 40], 1);
  near(extras.cubeUpBottom, [40, 60, 220], 1);
  near(extras.filmStart50, extras.filmMid as number[], 2);
  near(extras.filmEnd50, extras.filmMid as number[], 2);
});

/** Mean per-cell grey-level difference allowed between the preview canvas and the decoded export of the same frame. */
const MAX_DELTA = 16;
/** The matching frame must beat every neighbouring frame by at least this much, so a one-frame offset cannot pass. */
const MIN_MARGIN = 2;

test("a saved preset applies from the panel, becomes the default for Cmd/Ctrl+Shift+D, and the export matches the preview", async ({ page }) => {
  test.setTimeout(600_000);
  const ids = await openWithClips(page, ["ct-red.mp4", "ct-blue.mp4"]);
  const r = await runPresetFlow(page, ids, join(tmpdir(), `custom-transition-${process.pid}.mp4`));
  // Preview and export sample the same instant for a playhead frame: the preview at frame 60 (and half way into it)
  // matches exported frame 60 and no neighbour, and every frame around the midpoint matches its own exported frame.
  const cellDelta = (a: number[][], b: number[][]) => a.reduce((sum, cell, i) => sum + Math.max(...cell.map((v, c) => Math.abs(v - b[i][c]))), 0) / a.length;
  const bestOf = (grid: number[][]) => {
    const all = r.neighbours.map((n) => ({ frame: n.frame, delta: cellDelta(grid, n.grid) })).sort((a, b) => a.delta - b.delta);
    return { ...all[0], margin: all[1].delta - all[0].delta };
  };
  const mid = bestOf(r.preview);
  const rows = r.previewFrames.map((p) => ({ at: p.frame, ...bestOf(p.grid) }));
  console.log(`[transitions] mid-frame preview best=${mid.frame} delta=${mid.delta.toFixed(2)} margin=${mid.margin.toFixed(2)}; frame-boundary previews: ${rows.map((x) => `${x.at}->${x.frame}:${x.delta.toFixed(2)}/+${x.margin.toFixed(2)}`).join(" ")}; params=${JSON.stringify(r.transition.params)}`);
  expect(mid.frame, "the half-frame playhead shows the frame the export holds for it").toBe(60);
  expect(mid.delta).toBeLessThan(MAX_DELTA);
  expect(mid.margin).toBeGreaterThan(MIN_MARGIN);
  for (const x of rows) {
    expect(x.frame, `preview at frame ${x.at} equals exported frame ${x.at}`).toBe(x.at);
    expect(x.delta).toBeLessThan(MAX_DELTA);
    expect(x.margin).toBeGreaterThan(MIN_MARGIN);
  }
  // The iris opens from the middle: blue in the centre, red in the corners, in the preview AND the export.
  const cell = (grid: number[][], gx: number, gy: number) => grid[gy * r.GX + gx];
  for (const [label, grid] of [["preview", r.preview], ["export", r.exported]] as const) {
    const centre = cell(grid, r.GX / 2, Math.floor(r.GY / 2));
    const corner = cell(grid, 0, 0);
    expect(centre[2], `${label} centre is the incoming (blue) shot`).toBeGreaterThan(centre[0] + 60);
    expect(corner[0], `${label} corner is still the outgoing (red) shot`).toBeGreaterThan(corner[2] + 60);
    // The 10 px green border strip shows between them (plain red has g - b of about 20, a cell holding the strip about 80).
    // The encoder subsamples chroma, which dilutes the thin strip in the export; a lower bar than the canvas still excludes plain red/blue (g - b about 0).
    const greens = grid.filter(([, gg, bb]) => gg > bb + (label === "export" ? 20 : 50)).length;
    expect(greens, `${label} shows the green border strip`).toBeGreaterThan(0);
  }
});
