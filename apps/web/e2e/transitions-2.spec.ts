import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openHookPage } from "./helpers";
import { openWithClips } from "./lumetri-basic-lib";
import { ensureTransitionFixtures } from "./custom-transitions-lib";
import { applyLibraryPresetAndExport, reopenWithClips, runGpuTransitionParity, runNewTransitionParity, runPeelShadow, saveSplitToLibrary, storedLibraryPresets } from "./transitions-2-lib";

// Real-browser coverage of the second round of Premiere-style transitions: the Canvas2D TransitionEngine (the renderer
// preview and export share) against the software reference at 0, 0.25, 0.5, 0.75 and 1 for every new type and each
// direction, then an app-wide library preset saved from the UI, kept across a page reload, applied, undone, redone and
// exported with the preview matching the export frame for frame.

test.beforeAll(() => {
  ensureTransitionFixtures();
});

test("every new transition draws what its reference says at 0, 0.25, 0.5, 0.75 and 1, in each direction", async ({ page }) => {
  test.setTimeout(240_000);
  await openHookPage(page);
  const rows = await runNewTransitionParity(page);
  const worst = [...rows].sort((a, b) => b.mad - a.mad).slice(0, 4);
  console.log(`[transitions-2] ${rows.length} frames compared; worst mad: ${worst.map((r) => `${r.label}=${r.mad.toFixed(3)}/${r.max.toFixed(0)}`).join("; ")}`);
  expect(rows.length).toBeGreaterThan(180);
  for (const row of rows) {
    // Masks are exact up to antialiasing; the geometric plans differ from the pixel-centre reference along their edges only.
    const kind = (row as { kind?: string }).kind;
    expect(row.mad, `${row.label} mean abs diff`).toBeLessThan(kind === "mask" ? 0.35 : 1.6);
    if (kind === "mask") expect(row.max, `${row.label} max diff`).toBeLessThanOrEqual(6);
  }
  expect(await runPeelShadow(page), "the page peel's shadow darkens the incoming shot beside the fold").toBeGreaterThan(50);
});

/** Mean per-cell grey-level difference allowed between the preview canvas and the decoded export of the same frame. */
const MAX_DELTA = 4;
/** The matching frame must beat every neighbouring frame by at least this much, so a one-frame offset cannot pass. */
const MIN_MARGIN = 3;

test("a library preset survives a reload, applies and undoes, and the export matches the preview at the same frame", async ({ page }) => {
  test.setTimeout(600_000);
  let ids = await openWithClips(page, ["ct-red.mp4", "ct-blue.mp4"]);
  await saveSplitToLibrary(page, ids);
  const before = await storedLibraryPresets(page);
  expect(before).toMatchObject([{ name: "White split", type: "split", params: { orientation: "horizontal", borderWidth: 10, borderColor: "#ffffff" } }]);

  // A new page load is a new editor session: the project is gone, the library is not.
  await page.reload();
  ids = await reopenWithClips(page, ["ct-red.mp4", "ct-blue.mp4"]);
  expect(await storedLibraryPresets(page)).toEqual(before);

  const r = await applyLibraryPresetAndExport(page, ids, join(tmpdir(), `transitions-2-${process.pid}.mp4`));
  const cellDelta = (a: number[][], b: number[][]) => a.reduce((sum, cell, i) => sum + Math.max(...cell.map((v, c) => Math.abs(v - b[i][c]))), 0) / a.length;
  const bestOf = (grid: number[][]) => {
    const all = r.neighbours.map((n) => ({ frame: n.frame, delta: cellDelta(grid, n.grid) })).sort((a, b) => a.delta - b.delta);
    return { ...all[0], margin: all[1].delta - all[0].delta };
  };
  const mid = bestOf(r.preview);
  const rows = r.previewFrames.map((p) => ({ at: p.frame, ...bestOf(p.grid) }));
  console.log(`[transitions-2] mid-frame preview best=${mid.frame} delta=${mid.delta.toFixed(2)} margin=${mid.margin.toFixed(2)}; frame-boundary previews: ${rows.map((x) => `${x.at}->${x.frame}:${x.delta.toFixed(2)}/+${x.margin.toFixed(2)}`).join(" ")}`);
  expect(mid.frame, "the half-frame playhead shows the frame the export holds for it").toBe(60);
  expect(mid.delta).toBeLessThan(MAX_DELTA);
  expect(mid.margin).toBeGreaterThan(MIN_MARGIN);
  for (const x of rows) {
    expect(x.frame, `preview at frame ${x.at} equals exported frame ${x.at}`).toBe(x.at);
    expect(x.delta).toBeLessThan(MAX_DELTA);
    expect(x.margin).toBeGreaterThan(MIN_MARGIN);
  }
  // Half way through a horizontal split the outgoing (red) halves have slid to the sides and the incoming (blue) shot shows in
  // the middle, between two white border strips: in the preview and in the export.
  const cell = (grid: number[][], gx: number, gy: number) => grid[gy * r.GX + gx];
  for (const [label, grid] of [["preview", r.preview], ["export", r.exported]] as const) {
    const left = cell(grid, 1, Math.floor(r.GY / 2));
    const middle = cell(grid, r.GX / 2, Math.floor(r.GY / 2));
    const right = cell(grid, r.GX - 2, Math.floor(r.GY / 2));
    expect(left[0], `${label} left is the outgoing (red) shot`).toBeGreaterThan(left[2] + 60);
    expect(right[0], `${label} right is the outgoing (red) shot`).toBeGreaterThan(right[2] + 60);
    expect(middle[2], `${label} middle is the incoming (blue) shot`).toBeGreaterThan(middle[0] + 60);
    // A white strip is chroma-neutral, so the encoder keeps it: cells on the row that are brighter in every channel than either shot.
    const row = label === "preview" ? r.previewRow : r.exportedRow;
    expect(row.filter(([rr, gg, bb]) => Math.min(rr, gg, bb) > 100).length, `${label} shows the white border strips`).toBeGreaterThanOrEqual(2);
  }
});

test("the WebGPU transition renderer matches the Canvas2D engine for every transition at 0, 0.25, 0.5, 0.75 and 1", async ({ page }) => {
  test.setTimeout(300_000);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("TransitionGpu") || message.text().includes("TransitionEngine")) warnings.push(message.text());
  });
  await openHookPage(page);
  const { rows, gpuActive } = await runGpuTransitionParity(page);
  expect(gpuActive, "WebGPU transitions are active in the gpu project").toBe(true);
  const worst = [...rows].sort((a, b) => b.mad - a.mad).slice(0, 8);
  console.log(`[transitions-gpu] ${rows.length} frames; worst mad: ${worst.map((r) => `${r.label}=${r.mad.toFixed(2)}/${r.max}`).join("; ")}`);
  expect(rows.length).toBeGreaterThan(300);
  for (const row of rows) {
    expect(row.path, `${row.label} drew on the GPU (${warnings.join(" | ")})`).toBe("gpu");
    expect(row.mad, `${row.label} mean abs diff`).toBeLessThan(GPU_MAD_LIMIT[row.type] ?? DEFAULT_GPU_MAD);
  }
});

/** Mean absolute 0-255 difference allowed between a GPU frame and the Canvas2D reference. */
const DEFAULT_GPU_MAD = 1.5;
const GPU_MAD_LIMIT: Record<string, number> = {
  // A 64-tap gaussian against the browser's own blur filter: the same look, a different kernel.
  blur: 3,
  whipPan: 3.5,
};
