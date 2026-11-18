import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverage, frameAt, graphicSerial, graphicState, hideMain, insertFromBrowse, openTemplatesTab, runAuthoringFlow, runImportFlow } from "./essential-graphics-lib";
import { clipsOf, openEditor, readState, seek, settle, splitIntoThree, undo } from "./helpers";

/** A solid-colour PNG (w x h), built with zlib so no image library is needed. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
import { runNestParity, runParity } from "./essential-graphics-parity";

/**
 * Essential Graphics in real Chrome (WebGPU enabled): insert a lower third, change its
 * exposed name text and color in the Inspector, stretch it and verify the intro/outro
 * frames (in+0.25s, out-0.25s) are pixel-identical, save + export it as a template,
 * import that file into a brand new project and render the identical frames, and
 * undo every edit exactly.
 */
test("lower third: exposed controls, protected intro/outro, template round trip, exact undo", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const dir = mkdtempSync(join(tmpdir(), "openreel-eg-"));
  const file = join(dir, "e2e.openreel-template");
  const result = await runAuthoringFlow(page, file);
  const second = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  try {
    await runImportFlow(second, result.templatePath, result);
  } finally {
    await second.context().close();
  }
});

test("preview and export renderers agree on graphic frames", async ({ page }) => {
  test.setTimeout(300_000);
  const rows = await runParity(page, process.env.EG_ONLY ? process.env.EG_ONLY.split(",") : ["Classic Bar", "Hero Title", "Highlight Box", "Subscribe End Card"]);
  for (const row of rows) {
    // SVG layers share one rasterisation plan (core graphics/svg-raster) and sub-pixel exact
    // placement in preview and export, so even the thin Highlight Box outline agrees, on hardware
    // GPUs and on SwiftShader alike (100% within 40/255 measured under SwiftShader).
    expect(row.within, `${row.label}: graphic pixels within 40/255 (1px AA shift allowed)`).toBeGreaterThan(0.995);
    expect(row.exact, `${row.label}: same-pixel agreement within 24/255`).toBeGreaterThan(0.98);
    // (mean abs diff is printed, not asserted: it mixes in the preview stage colour behind soft edges)
  }
});

test("a graphic in an opened nest renders there and through the nest clip in the parent", async ({ page }) => {
  test.setTimeout(240_000);
  const result = await runNestParity(page);
  expect(result.ownChanged, "the graphic is visible inside the nest").toBeGreaterThan(0.01);
  expect(result.changed, "the graphic is visible through the nest clip in the parent").toBeGreaterThan(0.01);
  expect(result.within, "same pixels through the nest as in the nest itself").toBeGreaterThan(0.97);
});

test("sync lock: a ripple delete before a graphic shifts the whole graphic, and undo is exact", async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await splitIntoThree(page);
  await seek(page, 4.5);
  await insertFromBrowse(page, "Minimal Line");
  const before = await graphicState(page);
  const instance = before.instances[0];
  expect(instance.startTime).toBeCloseTo(4.5, 3);
  const serial = await graphicSerial(page);
  const [first] = clipsOf(await readState(page), "Main");
  const history = before.history;
  await page.evaluate(async (clipId) => {
    const r = await (window as any).__openreelE2E.project.getState().rippleDeleteClips([clipId]);
    if (!r.success) throw new Error(r.error?.message ?? "ripple failed");
  }, first.id);
  await settle(page, 700);
  const after = await graphicState(page);
  expect(after.history - history, "ripple delete is one undo step").toBe(1);
  expect(after.instances[0].startTime, "the graphic moved up by the removed 2s").toBeCloseTo(2.5, 3);
  expect(after.instances[0].duration).toBeCloseTo(instance.duration, 6);
  expect(after.shapes.every((c) => Math.abs(c.start - 2.5) < 1e-6), "every layer moved with it").toBe(true);
  expect(after.texts.every((c) => Math.abs(c.start - 2.5) < 1e-6)).toBe(true);
  await expect(page.locator(`[data-clip-kind="graphic"][data-graphic-id="${instance.id}"]`)).toBeVisible();
  await undo(page);
  expect(await graphicSerial(page), "undo restores the graphic exactly").toBe(serial);
});

test("group timeline clips into a graphic, add an image layer, and undo restores the clips", async ({ page }) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await hideMain(page);
  await seek(page, 0);
  const empty = await frameAt(page, 1);
  // A title and a bar on the Titles track, selected together.
  const ids = await page.evaluate(async () => {
    const e = (window as any).__openreelE2E;
    const state = e.project.getState();
    const titles = state.project.timeline.tracks.find((t: any) => t.name === "Titles");
    const text = state.createTextClip(titles.id, 0.5, "Group me", 4);
    const bar = state.createShapeClip(titles.id, 0.5, "rectangle", 4);
    e.ui.getState().select({ type: "shape-clip", id: bar.id, trackId: titles.id });
    e.ui.getState().select({ type: "text-clip", id: text.id, trackId: titles.id }, true);
    return { text: text.id, bar: bar.id };
  });
  await settle(page, 600);
  const serialBefore = await page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    return JSON.stringify([p.textClips, p.shapeClips, p.graphicInstances ?? null]);
  });
  const before = await graphicState(page);
  await openTemplatesTab(page);
  await page.getByRole("button", { name: /Group 2 selected clips into a graphic/ }).click();
  await expect.poll(async () => (await graphicState(page)).instances.length, { timeout: 15_000 }).toBe(1);
  const grouped = await graphicState(page);
  expect(grouped.history - before.history, "grouping is one undo step").toBe(1);
  expect(grouped.texts.every((t) => t.id.includes("__")), "the loose clips became layers of the graphic").toBe(true);
  expect(grouped.texts.some((t) => t.text === "Group me")).toBe(true);
  await expect(page.locator('[data-clip-kind="graphic"]')).toHaveCount(1);
  const framed = await frameAt(page, 1);
  expect(coverage(framed, empty), "the grouped graphic renders").toBeGreaterThan(0.002);

  // Add an image layer in Edit; it renders (data: URL inside an SVG wrapper).
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const dir = mkdtempSync(join(tmpdir(), "openreel-eg-img-"));
  const png = join(dir, "red.png");
  writeFileSync(png, solidPng(64, 32, [255, 0, 0]));
  await page.getByTestId("graphic-image-input").setInputFiles(png);
  await expect
    .poll(async () => page.evaluate(() => ((window as any).__openreelE2E.project.getState().getFullProject().graphicInstances?.[0]?.template.layers ?? []).some((l: any) => l.kind === "image")), { timeout: 15_000 })
    .toBe(true);
  await settle(page, 800);
  const withImage = await frameAt(page, 1);
  const redShare = await page.evaluate(async () => {
    const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
    return red / (d.length / 4);
  });
  expect(withImage.hash).not.toBe(framed.hash);
  expect(redShare, "the red image layer is visible").toBeGreaterThan(0.01);

  // Edit tab: select the image layer, centre it, move it down the stack, expose its opacity.
  const stateOf = () => page.evaluate(() => {
    const instance = (window as any).__openreelE2E.project.getState().getFullProject().graphicInstances[0];
    return { layers: instance.template.layers.map((l: any) => ({ id: l.id, x: l.x })), params: instance.template.parameters.map((p: any) => p.id), history: (window as any).__openreelE2E.project.getState().actionExecutor.getHistory().getUndoStackSize() };
  });
  const afterImage = await stateOf();
  await page.locator('[data-graphic-layer="image-1"] button[aria-pressed]').click();
  await page.getByRole("button", { name: "Align horizontal centers" }).click();
  await expect.poll(async () => (await stateOf()).layers.find((l: any) => l.id === "image-1")?.x).toBe(960);
  const order0 = (await stateOf()).layers.map((l: any) => l.id);
  await page.getByRole("button", { name: /Move Image 1 down/ }).click();
  await expect.poll(async () => (await stateOf()).layers.map((l: any) => l.id)).not.toEqual(order0);
  const order1 = (await stateOf()).layers.map((l: any) => l.id);
  expect(order1.indexOf("image-1")).toBe(order0.indexOf("image-1") - 1);
  await page.getByLabel("Control name").fill("Logo opacity");
  await page.getByRole("button", { name: "Expose Opacity" }).click();
  await expect.poll(async () => (await stateOf()).params.length).toBe(afterImage.params.length + 1);
  const afterEdits = await stateOf();
  expect(afterEdits.history - afterImage.history, "each Edit-tab change is one undo step").toBe(3);
  // The new control now shows in the Inspector.
  await expect(page.locator("[data-graphic-control]").filter({ hasText: "Logo opacity" })).toHaveCount(1);

  // Undo everything since grouping: the original clips come back exactly.
  await seek(page, 0);
  while ((await stateOf().catch(() => ({ history: before.history }))).history > before.history) {
    await undo(page);
    if ((await graphicState(page)).history <= before.history) break;
  }
  const serialAfter = await page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().getFullProject();
    return JSON.stringify([p.textClips, p.shapeClips, p.graphicInstances ?? null]);
  });
  expect(serialAfter, "undo restores the loose clips exactly").toBe(serialBefore);
  void ids;
});
