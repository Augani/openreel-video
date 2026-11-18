import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importInput, openEditor, settle } from "./helpers";
import { graphicState, hideMain, insertFromBrowse } from "./essential-graphics-lib";
import { CAMERAS, cameraPath, generateCameras, openMulticamEditor, frameColor, nearestCamera } from "./multicam-lib";
import { E2E_FFMPEG } from "./env";

/**
 * Wave 8 composition, in real Chrome:
 *  1. an Essential Graphics template and burned-in captions come out of ONE export (the graphic is
 *     in the exported picture, the caption is drawn over the same frames, each can be removed alone);
 *  2. multicam + proxies: the multicam monitor's angle tiles decode the proxy while proxies are on
 *     and the original when they are off; the export reads full-resolution media regardless;
 *  3. audio repair in a bus rack + the stems queue + the mixdown cache: a DeHum in the Dialogue bus
 *     rack removes the hum from that stem only, and editing the rack invalidates the cached mix.
 */

const FFMPEG = E2E_FFMPEG;
const workDir = mkdtempSync(join(tmpdir(), "openreel-w8-comp-"));

// ---------------------------------------------------------------------------------------------
// Shared: run a queued export and fetch the file.
// ---------------------------------------------------------------------------------------------
async function runJob(page: Page, id: string): Promise<{ outputName: string; job: Record<string, any> }> {
  await page.evaluate(() => (window as any).__openreelE2E.exportQueue.getState().start());
  const deadline = Date.now() + 240_000;
  for (;;) {
    const j = await page.evaluate((jobId) => {
      const x = (window as any).__openreelE2E.exportQueue.getState().queue.jobs.find((y: any) => y.id === jobId);
      return { ...x, status: x.status as string, outputName: x.outputName as string, error: x.error as string | undefined };
    }, id);
    if (j.status === "completed") return { outputName: j.outputName, job: j };
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`export ${j.status}: ${j.error}`);
    if (Date.now() > deadline) throw new Error(`export did not finish (${j.status})`);
    await page.waitForTimeout(300);
  }
}

async function download(page: Page, outputName: string, file: string): Promise<string> {
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: `Download ${outputName}` }).click()]);
  const path = join(workDir, file);
  await dl.saveAs(path);
  return path;
}

async function exportToFile(page: Page, settings: Record<string, unknown>, label: string, file: string): Promise<string> {
  const id = await page.evaluate(
    (payload) => {
      const job = (window as any).__openreelE2E.exportQueue.getState().enqueue(payload);
      if (!job) throw new Error("enqueue returned null");
      return job.id as string;
    },
    { settings, presetLabel: label },
  );
  const { outputName } = await runJob(page, id);
  return download(page, outputName, file);
}

const grayFrame = (file: string, t: number): Buffer =>
  execFileSync(FFMPEG, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=640:360", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });

/** Pixels in rows [y0, y1) that differ by more than a codec-noise threshold. */
function differing(a: Buffer, b: Buffer, rows: [number, number]): number {
  let n = 0;
  for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < 640; x++) if (Math.abs(a[y * 640 + x] - b[y * 640 + x]) > 24) n++;
  return n;
}
const ink = (a: Buffer): number => a.reduce((n, v) => n + (v > 40 ? 1 : 0), 0);

// ---------------------------------------------------------------------------------------------
// 1. Graphics + burned-in captions in the same export
// ---------------------------------------------------------------------------------------------
const TRANSCRIPT = {
  language: "en",
  segments: [
    {
      speaker: "Ann",
      words: [
        { word: "Welcome", start: 0.5, end: 0.9 },
        { word: "to", start: 0.9, end: 1.0 },
        { word: "the", start: 1.0, end: 1.1 },
        { word: "show.", start: 1.1, end: 1.9 },
      ],
    },
  ],
};

test("an Essential Graphics template and burned-in captions are in the same export, and each can be removed alone", async ({ page }, testInfo) => {
  testInfo.setTimeout(480_000);
  await openEditor(page);
  await page.getByRole("button", { name: "Text & captions", exact: true }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.getByTestId("transcript-panel").waitFor();
  await page.getByTestId("transcript-import-input").setInputFiles({ name: "t.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(TRANSCRIPT)) });
  await expect.poll(() => page.evaluate(() => (window as any).__openreelE2E.project.getState().project.timeline.subtitles.length)).toBe(1);

  await insertFromBrowse(page, "Classic Bar");
  const [instance] = (await graphicState(page)).instances;
  expect(instance.startTime).toBeLessThan(0.5);
  expect(instance.startTime + instance.duration).toBeGreaterThan(1.5);
  await hideMain(page); // black background: frames contain only the graphic and the caption

  const SMALL = { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 };
  const both = await exportToFile(page, { ...SMALL }, "Graphic + burned captions", "both.mp4");
  const graphicOnly = await exportToFile(
    page,
    { ...SMALL, captions: { tracks: [{ captionTrackId: "", burnIn: false, sidecar: "none", embedded: "none" }] } },
    "Graphic only",
    "graphic-only.mp4",
  );
  const removed = await page.evaluate((id) => (window as any).__openreelE2E.graphics.removeGraphicCommand(id), instance.id);
  expect(removed.ok, JSON.stringify(removed)).toBe(true);
  await settle(page, 500);
  const captionOnly = await exportToFile(page, { ...SMALL }, "Burned captions only", "caption-only.mp4");

  // At t = 1.2 the caption cue and the graphic are both on screen.
  const t = 1.2;
  const fBoth = grayFrame(both, t);
  const fGraphic = grayFrame(graphicOnly, t);
  const fCaption = grayFrame(captionOnly, t);
  const captionDelta = differing(fBoth, fGraphic, [0, 360]);
  const graphicDelta = differing(fBoth, fCaption, [0, 360]);
  console.log(`[w8] export frame t=${t}: ink both=${ink(fBoth)} graphic-only=${ink(fGraphic)} caption-only=${ink(fCaption)}; burn-in adds ${captionDelta} px, graphic adds ${graphicDelta} px`);
  expect(ink(fGraphic), "the graphic is in the export").toBeGreaterThan(500);
  expect(ink(fCaption), "the caption is in the export").toBeGreaterThan(100);
  expect(captionDelta, "burning captions in changes the picture").toBeGreaterThan(100);
  expect(graphicDelta, "the graphic changes the picture").toBeGreaterThan(500);
  // Both together carry (almost) everything either one draws alone.
  expect(ink(fBoth)).toBeGreaterThan(Math.max(ink(fGraphic), ink(fCaption)));
  expect(ink(fBoth)).toBeLessThanOrEqual(ink(fGraphic) + ink(fCaption) + 50);
  // Past the cue (t = 3) only the graphic remains: both == graphic-only.
  expect(differing(grayFrame(both, 3), grayFrame(graphicOnly, 3), [0, 360])).toBeLessThan(60);
  writeFileSync(testInfo.outputPath("w8-graphics-captions.json"), JSON.stringify({ ink: [ink(fBoth), ink(fGraphic), ink(fCaption)], captionDelta, graphicDelta }));
});

// ---------------------------------------------------------------------------------------------
// 2. Multicam + proxies
// ---------------------------------------------------------------------------------------------
test("multicam angles decode the proxy while proxies are on and the original when off; export reads full resolution", async ({ page }, testInfo) => {
  testInfo.setTimeout(420_000);
  generateCameras();
  await openMulticamEditor(page);

  // A hand-made proxy of cam-red that is visibly different (black and white, quarter size).
  const proxyPath = join(workDir, "cam-red-proxy.mp4");
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", cameraPath(0), "-vf", "scale=320:180,format=gray,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", proxyPath]);
  const proxyB64 = readFileSync(proxyPath).toString("base64");

  const ids = await page.evaluate(() => {
    const p = (window as any).__openreelE2E.project.getState().project;
    return ["cam-red.mp4", "cam-green.mp4", "cam-blue.mp4"].map((n) => p.mediaLibrary.items.find((m: any) => m.name === n).id as string);
  });
  const created = await page.evaluate(
    async ({ ids, offsets }) => {
      const h = (window as any).__openreelE2E;
      return h.multicamController.createMulticamSourceCommand({
        name: "Proxy cut",
        syncMethod: "manual",
        angles: ids.map((mediaId: string, i: number) => ({ mediaId, offset: offsets[i] })),
        audio: { mode: "follow" },
        placeAtPlayhead: true,
      });
    },
    { ids, offsets: CAMERAS.map((c) => c.offset) },
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);
  await page.evaluate(() => (window as any).__openreelE2E.source.getState().setTab("multicam"));
  await page.getByTestId("multicam-monitor").waitFor({ timeout: 20_000 });
  const tiles = page.getByTestId("multicam-angle");
  await expect(tiles).toHaveCount(3);

  const decodeSource = (mediaId: string) =>
    page.evaluate((id) => {
      const d = (window as any).__openreelE2E.proxy.cache.decodes[id];
      return d ? { source: d.source as string, proxy: d.proxyCount as number, original: d.originalCount as number } : null;
    }, mediaId);
  // Centre-pixel colourfulness of the first angle's <video>: a gray proxy has none, the red camera a lot.
  const tileChroma = () =>
    page.evaluate(async () => {
      const video = document.querySelector('[data-testid="multicam-angle"][data-angle-index="1"] video') as HTMLVideoElement;
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) resolve();
        else video.addEventListener("loadeddata", () => resolve(), { once: true });
      });
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 18;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(video, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data;
      let chroma = 0;
      for (let i = 0; i < d.length; i += 4) chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      return { chroma: chroma / (d.length / 4), width: video.videoWidth };
    });

  // Baseline: no proxy yet, the tile decodes the original (a red camera).
  await expect.poll(async () => (await decodeSource(ids[0]))?.source).toBe("original");
  const original = await tileChroma();
  expect(original.chroma, "original is colourful").toBeGreaterThan(40);
  expect(original.width).toBe(640);

  // Attach the proxy as a ready cache entry (what an ingest/attach does) with proxies on.
  await page.evaluate(
    async ({ id, b64 }) => {
      const h = (window as any).__openreelE2E;
      const item = h.project.getState().project.mediaLibrary.items.find((m: any) => m.id === id);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      h.proxy.cache.hydrate(item, new Blob([bytes], { type: "video/mp4" }), { width: 320, height: 180 });
      h.proxy.cache.setProxiesOn(true);
    },
    { id: ids[0], b64: proxyB64 },
  );
  await expect.poll(async () => (await decodeSource(ids[0]))?.source, { timeout: 20_000 }).toBe("proxy");
  await expect.poll(async () => (await tileChroma()).width, { timeout: 20_000 }).toBe(320);
  const proxied = await tileChroma();
  console.log(`[w8] multicam angle 1 tile: original chroma ${original.chroma.toFixed(1)} (${original.width}px), proxy chroma ${proxied.chroma.toFixed(1)} (${proxied.width}px)`);
  expect(proxied.chroma, "the proxy is gray").toBeLessThan(8);
  // The other angles have no proxy and keep decoding their originals.
  expect((await decodeSource(ids[1]))?.source).toBe("original");

  // Export while proxies are ON: the file is made from the full-resolution camera (red), not the gray proxy.
  const file = await exportToFile(page, { width: 640, height: 360, frameRate: 30, format: "mp4", codec: "h264", bitrate: 2000 }, "Multicam with proxies on", "multicam-proxy.mp4");
  const colour = frameColor(file, 1.0);
  console.log(`[w8] multicam export frame colour with proxies on: ${colour.join(",")} -> ${nearestCamera(colour)}`);
  expect(nearestCamera(colour)).toBe("red");
  expect(colour[0] - colour[1], "colour, not gray: the export did not use the proxy").toBeGreaterThan(100);

  // Proxies off: the tile goes back to the original.
  await page.evaluate(() => (window as any).__openreelE2E.proxy.cache.setProxiesOn(false));
  await expect.poll(async () => (await decodeSource(ids[0]))?.source, { timeout: 20_000 }).toBe("original");
  await expect.poll(async () => (await tileChroma()).width, { timeout: 20_000 }).toBe(640);
});

// ---------------------------------------------------------------------------------------------
// 3. Audio repair in a bus rack, the stems queue and the mixdown cache
// ---------------------------------------------------------------------------------------------
const SR = 48000;
function writeHumWav(path: string): void {
  const seconds = 3;
  const n = SR * seconds;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const voice = 0.2 * Math.sin(2 * Math.PI * 330 * t);
    const hum = 0.08 * Math.sin(2 * Math.PI * 60 * t) + 0.04 * Math.sin(2 * Math.PI * 120 * t);
    pcm.writeInt16LE(Math.round((voice + hum) * 32767), 44 + i * 2);
  }
  writeFileSync(path, pcm);
}
const toneAmp = (x: Float32Array, freq: number, from: number, to: number): number => {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
};

async function runStems(page: Page, label: string, dir: string): Promise<Record<string, Float32Array>> {
  const panel = page.getByTestId("export-queue-panel");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Export queue", exact: true }).click();
  await panel.getByTestId("export-queue-add-stems").click();
  await page.getByTestId("export-queue-stems-form").getByTestId("export-queue-add-stems-confirm").click();
  const jobs = panel.getByTestId("export-queue-job");
  const index = (await jobs.count()) - 1;
  // The queue keeps running after the first Start; a later job just waits its turn.
  const start = panel.getByRole("button", { name: "Start queue" });
  if (await start.isVisible({ timeout: 3000 }).catch(() => false)) await start.click();
  await expect(jobs.nth(index)).toHaveAttribute("data-status", "completed", { timeout: 180_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), jobs.nth(index).getByRole("button", { name: /^Download .*\.zip$/ }).click()]);
  const zip = join(workDir, `${label}.zip`);
  await dl.saveAs(zip);
  const out = join(workDir, dir);
  mkdirSync(out, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zip, "-d", out]);
  const result: Record<string, Float32Array> = {};
  for (const name of execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n")) {
    const pcm = execFileSync(FFMPEG, ["-v", "error", "-i", join(out, name), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 128 * 1024 * 1024 });
    result[name.toLowerCase()] = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }
  return result;
}

test("a DeHum in a bus rack cleans that bus's stem only, and editing the rack invalidates the cached mixdown", async ({ page }, testInfo) => {
  testInfo.setTimeout(480_000);
  const wav = join(workDir, "hum-voice.wav");
  writeHumWav(wav);
  await openEditor(page);
  await importInput(page).setInputFiles(wav);
  await page.getByLabel("Select media hum-voice.wav").waitFor({ timeout: 30_000 });
  const placed = await page.evaluate(async () => {
    const st = (window as any).__openreelE2E.project.getState();
    const item = st.project.mediaLibrary.items.find((m: any) => m.name === "hum-voice.wav");
    const main = st.project.timeline.tracks.find((t: any) => t.name === "Main");
    await st.muteTrack(main.id, true);
    const results = [];
    for (const lane of ["Dialogue", "Music"]) {
      const track = (window as any).__openreelE2E.project.getState().project.timeline.tracks.find((t: any) => t.name === lane);
      results.push((await (window as any).__openreelE2E.project.getState().addClip(track.id, item.id, 0)).success);
    }
    return results;
  });
  expect(placed).toEqual([true, true]);
  await page.evaluate(() => (window as any).__openreelE2E.ui.getState().togglePanel("audioMixer"));
  await page.getByTestId("audio-mixer").waitFor({ timeout: 15_000 });
  await page.getByTestId("add-stem-buses").click();
  await expect.poll(() => page.evaluate(() => ((window as any).__openreelE2E.project.getState().project.timeline.audioBuses ?? []).length)).toBe(3);
  await page.evaluate(() => (window as any).__openreelE2E.ui.getState().togglePanel("audioMixer"));

  const before = await runStems(page, "stems-before", "stems-before");
  const dialogueKey = Object.keys(before).find((k) => k.includes("dialogue"))!;
  const musicKey = Object.keys(before).find((k) => k.includes("music"))!;
  expect(dialogueKey && musicKey, `stem names: ${Object.keys(before)}`).toBeTruthy();
  const hum = (x: Float32Array) => toneAmp(x, 60, SR / 2, SR * 2);
  const humBefore = [hum(before[dialogueKey]), hum(before[musicKey])];
  console.log(`[w8] stems before: 60 Hz dialogue ${humBefore[0].toFixed(5)}, music ${humBefore[1].toFixed(5)}`);
  expect(humBefore[0]).toBeGreaterThan(0.05);

  // DeHum on the Dialogue bus rack (one undo step, the mixer's own action).
  const busId = await page.evaluate(() => (window as any).__openreelE2E.project.getState().project.timeline.audioBuses.find((b: any) => /dialogue/i.test(b.name)).id as string);
  const applied = await page.evaluate(async (id) => {
    const h = (window as any).__openreelE2E;
    const effect = h.audio.createRackEffect("deHum", { params: { frequency: 60, harmonics: 4, q: 30, depth: 1 } });
    return h.project.getState().setAudioRack(id, { effects: [effect] });
  }, busId);
  expect(applied.success, JSON.stringify(applied)).toBe(true);
  await settle(page, 400);

  const after = await runStems(page, "stems-after", "stems-after");
  const humAfter = [hum(after[dialogueKey]), hum(after[musicKey])];
  const drop = 20 * Math.log10(humBefore[0] / humAfter[0]);
  console.log(`[w8] stems after DeHum on the Dialogue bus: 60 Hz dialogue ${humAfter[0].toFixed(5)} (-${drop.toFixed(1)} dB), music ${humAfter[1].toFixed(5)}`);
  expect(drop, "the Dialogue stem lost its hum (cached mix was invalidated by the rack edit)").toBeGreaterThan(20);
  expect(Math.abs(20 * Math.log10(humAfter[1] / humBefore[1])), "the Music stem is untouched").toBeLessThan(1);
  // The 330 Hz voice survives.
  const voice = (x: Float32Array) => toneAmp(x, 330, SR / 2, SR * 2);
  expect(Math.abs(20 * Math.log10(voice(after[dialogueKey]) / voice(before[dialogueKey])))).toBeLessThan(1.5);
});
