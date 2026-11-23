import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clickClip, openEditor, readState, seek, settle } from "./helpers";
import {
  H,
  W,
  box,
  dist,
  ensureVrFixture,
  exportMp4,
  exportedFrames,
  ffprobeStreams,
  importVrClip,
  psnr,
  removeAllClips,
  renderRgba,
  setSequence,
  workDir,
  type Hook,
} from "./vr-video-lib";

/**
 * Immersive video, second batch, end to end in the real editor on the generated equirectangular clip:
 *  - Effects panel > Immersive lists VR Sharpen, Glow, Chromatic Aberrations, Digital Glitch and De-Noise, each adds to a
 *    clip with the sequence's frame layout;
 *  - the Source monitor VR view (toggle, drag, zoom, reset) is independent of the Program monitor's, reads the clip's VR
 *    Properties and never changes the Program frame or an export;
 *  - with all five effects on the clip, the preview render and the export-mode render agree at several frames (including the
 *    time-driven glitch) and the exported MP4 matches the engine within codec loss;
 *  - the export carries V2 (st3d + sv3d with the initial view pose) AND the V1 uuid XML (ffprobe + a scan of the file).
 */
const NEW_EFFECTS = [
  { label: "VR Sharpen", type: "vr-sharpen", params: { amount: 80, radius: 1.2 } },
  { label: "VR Glow", type: "vr-glow", params: { threshold: 35, radius: 4, brightness: 180 } },
  { label: "VR Chromatic Aberrations", type: "vr-chromatic-aberrations", params: { amount: 70, pan: 20, tilt: 5 } },
  { label: "VR Digital Glitch", type: "vr-digital-glitch", params: { intensity: 55, seed: 5, rate: 12 } },
  { label: "VR De-Noise", type: "vr-de-noise", params: { amount: 40, radius: 0.6 } },
] as const;

export function registerVrVideo2Tests(): void {
  test.beforeAll(async () => { await ensureVrFixture(); });

  test("VR video 2: new immersive effects, Source monitor VR view, V1 + V2 metadata with an initial view", async ({ page }, testInfo) => {
    testInfo.setTimeout(420_000);
    const notes: string[] = [];
    await openEditor(page);
    await removeAllClips(page);
    await setSequence(page, { width: W, height: H, vr: { projection: "equirectangular", layout: "mono", horizontalFov: 360, verticalFov: 180, initialView: { yaw: 30, pitch: 10, roll: 0 } } });
    const clipId = await importVrClip(page);
    await seek(page, 0.2);
    await settle(page, 600);

    // ---- Effects panel: Immersive category lists the five effects, each applies --------------------------------------------------
    await clickClip(page, clipId);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("button", { name: "Immersive", exact: true }).first().click();
    for (const fx of NEW_EFFECTS) {
      const card = page.locator(`button[aria-label^="${fx.label}. Drag"]`).first();
      await expect(card, `${fx.label} card in Effects > Immersive`).toBeVisible();
    }
    const effectsOf = () => page.evaluate(() => {
      const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
      return project.timeline.tracks.flatMap((t: any) => t.clips).flatMap((c: any) => (c.effects ?? []).map((e: any) => ({ id: e.id as string, type: e.type as string, params: { ...e.params } as Record<string, any> })));
    });
    for (const fx of NEW_EFFECTS) {
      const card = page.locator(`button[aria-label^="${fx.label}. Drag"]`).first();
      await card.scrollIntoViewIfNeeded();
      await card.dblclick();
      await expect.poll(async () => (await effectsOf()).some((e) => e.type === fx.type), { timeout: 15_000 }).toBe(true);
    }
    const effects = await effectsOf();
    for (const e of effects) expect(e.params.layout, `${e.type} takes the sequence layout`).toBe("mono");
    // Tune them to clearly visible values (the card defaults are conservative).
    for (const fx of NEW_EFFECTS) {
      const e = effects.find((x) => x.type === fx.type)!;
      await page.evaluate(async ([id, effectId, params]) => {
        await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().updateVideoEffect(id as string, effectId as string, params as Record<string, unknown>);
      }, [clipId, e.id, fx.params] as const);
    }
    await settle(page, 600);

    // ---- Preview vs export-mode renders with all five effects, glitch included -----------------------------------------------------
    const stripped = await renderRgba(page, 0.4, false, W, H, true);
    const withFx = await renderRgba(page, 0.4, false, W, H);
    const changedPsnr = psnr(stripped, withFx);
    notes.push(`five effects vs none at 0.4s: PSNR ${changedPsnr.toFixed(1)} dB`);
    expect(changedPsnr, "the effects visibly change the picture").toBeLessThan(45);
    for (const t of [0, 0.2, 0.45, 0.8, 0.97]) {
      const p = psnr(await renderRgba(page, t, false, W, H), await renderRgba(page, t, true, W, H));
      notes.push(`preview vs export-mode at ${t}s: PSNR ${p.toFixed(1)} dB`);
      expect(p, `preview and export-mode renders agree at ${t}s`).toBeGreaterThan(60);
    }
    // The glitch re-rolls with the clip time (deterministically).
    const glitchOnly = effects.filter((e) => e.type !== "vr-digital-glitch");
    for (const e of glitchOnly) await page.evaluate(async ([id, effectId]) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().updateVideoEffect(id as string, effectId as string, { enabled: false }); }, [clipId, e.id] as const);
    const a0 = await renderRgba(page, 0.1, false, W, H);
    const a1 = await renderRgba(page, 0.1, false, W, H);
    const b0 = await renderRgba(page, 0.6, false, W, H);
    expect(psnr(a0, a1), "the same time renders the same glitch").toBeGreaterThan(90);
    notes.push(`glitch frame 0.1s vs 0.6s: PSNR ${psnr(a0, b0).toFixed(1)} dB`);
    expect(psnr(a0, b0), "another time re-rolls the glitch").toBeLessThan(40);
    for (const e of glitchOnly) await page.evaluate(async ([id, effectId]) => { await (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().updateVideoEffect(id as string, effectId as string, { enabled: true }); }, [clipId, e.id] as const);

    // ---- Source monitor VR view -------------------------------------------------------------------------------------------------------
    const mediaName = "equirect-grid-v1.mp4";
    await page.evaluate((name) => {
      const e = (window as unknown as { __openreelE2E: Hook & { source: { getState(): { open(mediaId: string, projectId: string): void } } } }).__openreelE2E;
      const project = e.project.getState().project;
      const media = project.mediaLibrary.items.find((m: any) => m.name === name);
      if (!media) throw new Error("media not found");
      e.source.getState().open(media.id, project.id);
    }, mediaName);
    await expect(page.getByTestId("source-monitor")).toBeVisible();
    await settle(page, 800);
    const toggle = page.getByTestId("source-vr-toggle");
    await expect(toggle, "the clip is VR (its metadata), so the Source VR view is available").toBeEnabled();
    const programBefore = await page.evaluate(() => {
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement | null;
      return c ? { w: c.width, h: c.height } : null;
    });
    await toggle.click();
    const overlay = page.getByTestId("source-vr-monitor-overlay");
    await expect(overlay).toBeVisible();
    const canvas = overlay.locator("canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("data-drawn")), { timeout: 20_000 }).toBeGreaterThan(2);
    const state = await page.evaluate(() => {
      const h = (window as unknown as { __openreelE2E: Hook & { sourceVrView: { getState(): Record<string, any> } } }).__openreelE2E;
      return { source: h.sourceVrView.getState().enabled as boolean, program: h.vrView.getState().enabled as boolean };
    });
    expect(state, "the Source monitor view is independent of the Program monitor view").toEqual({ source: true, program: false });
    const viewPixel = await canvas.evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext("2d", { willReadFrequently: true })!;
      const d = g.getImageData(Math.floor(c.width / 2) - 2, Math.floor(c.height / 2) - 2, 5, 5).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return [r / 25, gg / 25, b / 25];
    });
    // The centre of the clip's equirect frame at the playhead of the Source monitor (frame 0 of the grid = straight ahead).
    const sourceVideoCentre = await page.evaluate(() => {
      const v = document.querySelector('[data-testid="source-video"]') as HTMLVideoElement;
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(v, 0, 0);
      const d = g.getImageData(Math.floor(c.width / 2) - 2, Math.floor(c.height / 2) - 2, 5, 5).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      return [r / 25, gg / 25, b / 25];
    });
    notes.push(`Source VR view centre ${viewPixel.map((v) => v.toFixed(0))} vs source frame centre ${sourceVideoCentre.map((v) => v.toFixed(0))}`);
    expect(dist(viewPixel, sourceVideoCentre), "the Source VR view looks straight ahead").toBeLessThan(26);
    const ob = (await overlay.boundingBox())!;
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
    await page.mouse.down();
    await page.mouse.move(ob.x + ob.width / 2 + 160, ob.y + ob.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    expect(Number(await overlay.getAttribute("data-pan")), "dragging right turns the Source view left").toBeLessThan(-5);
    const fov0 = Number(await overlay.getAttribute("data-fov"));
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Number(await overlay.getAttribute("data-fov"))).toBeLessThan(fov0);
    await page.getByTestId("source-vr-view-reset").click();
    await expect.poll(async () => [Number(await overlay.getAttribute("data-pan")), Number(await overlay.getAttribute("data-tilt")), Number(await overlay.getAttribute("data-fov"))]).toEqual([0, 0, 90]);
    const programAfter = await page.evaluate(() => {
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement | null;
      return c ? { w: c.width, h: c.height } : null;
    });
    expect(programAfter, "the Source VR view does not resize or replace the Program frame").toEqual(programBefore);
    await page.getByTestId("source-vr-view-close").click();
    await expect(overlay).toBeHidden();

    // ---- Export: matches the engine, V2 + V1 metadata with the initial view ----------------------------------------------------------
    const file = join(workDir, "vr2-export.mp4");
    await exportMp4(page, file, { width: W, height: H, frameRate: 30, format: "mp4", codec: "h264", bitrate: 6000 }, 1);
    const probe = ffprobeStreams(file);
    notes.push(`ffprobe of the export:\n${probe.split("\n").filter((l) => /side_data_type|projection|yaw|pitch|roll|^type=/.test(l)).join("\n")}`);
    expect(probe).toContain("side_data_type=Spherical Mapping");
    expect(probe).toContain("projection=equirectangular");
    expect(probe).toMatch(/yaw=30/);
    expect(probe).toMatch(/pitch=10/);
    const bytes = readFileSync(file).toString("latin1");
    expect(bytes, "V1 uuid XML written alongside V2").toContain("<GSpherical:Spherical>true</GSpherical:Spherical>");
    expect(bytes).toContain("<GSpherical:InitialViewHeadingDegrees>30</GSpherical:InitialViewHeadingDegrees>");
    expect(bytes).toContain("<GSpherical:InitialViewPitchDegrees>10</GSpherical:InitialViewPitchDegrees>");
    expect(bytes.split("GSpherical:Spherical>true").length - 1, "one V1 box").toBe(1);
    expect(bytes.split("st3d").length - 1, "one st3d box").toBe(1);
    const frames = exportedFrames(file, W, H);
    expect(frames.length).toBeGreaterThanOrEqual(25);
    for (const k of [0, 9, 18]) {
      const p = psnr(frames[k], await renderRgba(page, k / 30, true, W, H));
      notes.push(`exported frame ${k} vs export-mode engine: PSNR ${p.toFixed(1)} dB`);
      expect(p, `exported frame ${k} matches the engine within codec loss`).toBeGreaterThan(26);
    }
    void readState;
    void box;
    console.log(`\n[vr-video-2 e2e]\n${notes.join("\n")}`);
    testInfo.annotations.push({ type: "vr-video-2", description: notes.join("\n") });
  });
}
