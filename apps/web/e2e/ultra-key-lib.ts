import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "./global-setup";
import { clickClip, importInput, openEditor, readState, seek, settle, snap } from "./helpers";

/**
 * Ultra Key on real footage: a green-screen clip generated with ffmpeg (a lit, noisy green screen with a skin-toned subject),
 * keyed through the real inspector: effect applied from the Effects panel, key colour picked with the Program monitor
 * eyedropper, output views, keyframes, and the GLSL shader checked against the CPU reference (the Canvas2D fallback / export path).
 * Shared by the gpu project (ultra-key.spec.ts) and the fallback projects (fallback-ultra-key.spec.ts).
 */

export const GREEN_SCREEN_PATH = join(FIXTURE_DIR, "green-screen-v1.mp4");
/** Frame fractions: bare screen and the middle of the subject. */
const SCREEN = { x: 0.1, y: 0.5 };
const SUBJECT = { x: 0.5, y: 0.5 };

export function ensureGreenScreenFixture(): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  if (existsSync(GREEN_SCREEN_PATH)) return;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=0x14b44c:s=640x360:r=30:d=3,vignette=angle=PI/5,noise=alls=7:allf=t,drawbox=x=220:y=60:w=200:h=260:color=0xd9a07a:t=fill,drawbox=x=250:y=90:w=60:h=40:color=0x2a3f8f:t=fill,format=yuv420p",
      "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
      "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
      "-movflags", "+write_colr",
      GREEN_SCREEN_PATH,
    ],
    { stdio: "ignore" },
  );
}

interface E2EStores {
  project: { getState(): Record<string, any> };
}

const PROGRAM = 'canvas[aria-label^="Program frame"]';

async function pixel(page: Page, key: string, at: { x: number; y: number }): Promise<[number, number, number]> {
  return page.evaluate(
    ([k, fx, fy]) => {
      const d = (window as unknown as { __snaps: Record<string, Uint8ClampedArray> }).__snaps[k as string];
      const c = document.querySelector('canvas[aria-label^="Program frame"]') as HTMLCanvasElement;
      const x = Math.floor((fx as number) * c.width);
      const y = Math.floor((fy as number) * c.height);
      const i = (y * c.width + x) * 4;
      return [d[i], d[i + 1], d[i + 2]] as [number, number, number];
    },
    [key, at.x, at.y] as const,
  );
}

/** Re-captures the Program frame until `ok` holds for the pixel (the picker refresh and the effect update land async under load). */
async function snapUntil(
  page: Page,
  key: string,
  at: { x: number; y: number },
  ok: (px: [number, number, number]) => boolean,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await snap(page, key);
        return ok(await pixel(page, key, at));
      },
      { timeout: 25_000, intervals: [300, 500, 1000] },
    )
    .toBe(true);
}

async function ultraKeyEffects(page: Page): Promise<Array<{ id: string; params: Record<string, any> }>> {
  return page.evaluate(() => {
    const project = (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project.getState().project;
    const out: Array<{ id: string; params: Record<string, any> }> = [];
    for (const track of project.timeline.tracks)
      for (const clip of track.clips)
        for (const effect of clip.effects ?? []) if (effect.type === "ultra-key") out.push({ id: effect.id, params: { ...effect.params } });
    return out;
  });
}

async function importGreenClip(page: Page): Promise<string> {
  const allClips = async () => (await readState(page)).tracks.flatMap((t) => t.clips);
  const known = new Set((await allClips()).map((c) => c.id));
  await importInput(page).setInputFiles(GREEN_SCREEN_PATH);
  await page.getByLabel("Select media green-screen-v1.mp4").waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: "Media actions for green-screen-v1.mp4" }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await expect.poll(async () => (await allClips()).length, { timeout: 30_000 }).toBe(known.size + 1);
  const green = (await allClips()).find((c) => !known.has(c.id));
  if (!green) throw new Error("the green screen clip was not added");
  await seek(page, green.start + 0.5);
  await clickClip(page, green.id);
  return green.id;
}

export function registerUltraKeyTests(): void {
  test.beforeAll(() => ensureGreenScreenFixture());

  test("Ultra Key: apply from the Effects panel, eyedropper the screen, key it on the Program monitor, output views, keyframes", async ({ page }) => {
    test.setTimeout(420_000);
    await openEditor(page);
    const clipId = await importGreenClip(page);
    await settle(page, 900);
    await snap(page, "source");
    const screenBefore = await pixel(page, "source", SCREEN);
    const subjectBefore = await pixel(page, "source", SUBJECT);
    console.log(`[ultra-key] source screen=${screenBefore} subject=${subjectBefore}`);
    expect(screenBefore[1], "the clip is a green screen").toBeGreaterThan(screenBefore[0] + 40);
    expect(subjectBefore[0], "the subject is skin toned").toBeGreaterThan(subjectBefore[1]);

    // Apply from the Keying chip of the Effects panel (double-click a card applies it to the selected clip).
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("button", { name: "Keying", exact: true }).first().click();
    const card = page.locator('button[aria-label^="Ultra Key. Drag"]').first();
    await card.scrollIntoViewIfNeeded();
    await card.dblclick();
    await expect.poll(async () => (await ultraKeyEffects(page)).length, { timeout: 15_000 }).toBe(1);
    const [fx] = await ultraKeyEffects(page);
    expect(fx.params.keyG, "authored defaults are written").toBe(255);
    expect(fx.params.tolerance).toBe(50);

    // Point the key somewhere wrong, then fix it with the eyedropper on the Program monitor.
    await page.evaluate(
      async ([c, e]) => {
        await (window as unknown as { __openreelE2E: E2EStores }).__openreelE2E.project
          .getState()
          .updateVideoEffect(c as string, e as string, { keyR: 255, keyG: 0, keyB: 0 });
      },
      [clipId, fx.id] as const,
    );
    await settle(page, 600);
    await page.getByRole("button", { name: "Edit Ultra Key" }).click();
    await expect(page.getByTestId("ultra-key-controls")).toBeVisible({ timeout: 15_000 });
    await snap(page, "wrong-key");
    // A red key leaves the green screen on the monitor.
    expect((await pixel(page, "wrong-key", SCREEN))[1]).toBeGreaterThan(60);

    await page.getByRole("button", { name: "Pick key color from the Program monitor" }).click();
    await page.getByTestId("ultra-key-picker-layer").waitFor();
    await settle(page, 900);
    const box = await page.locator(PROGRAM).boundingBox();
    if (!box) throw new Error("no Program canvas box");
    await page.mouse.click(box.x + box.width * SCREEN.x, box.y + box.height * SCREEN.y);
    await expect(page.getByTestId("ultra-key-picker-layer")).toHaveCount(0);
    await expect
      .poll(async () => (await ultraKeyEffects(page))[0].params.keyG, { timeout: 10_000 })
      .toBeGreaterThan(70);
    const picked = (await ultraKeyEffects(page))[0].params;
    console.log(`[ultra-key] picked key ${picked.keyR},${picked.keyG},${picked.keyB}`);
    expect(picked.keyR).toBeLessThan(90);
    expect(picked.keyG).toBeGreaterThan(picked.keyR + 60);
    await settle(page, 900);

    // Composite: the screen is gone, the subject is untouched.
    await snapUntil(page, "keyed", SCREEN, (px) => px[1] < px[0] + 20);
    const screenKeyed = await pixel(page, "keyed", SCREEN);
    const subjectKeyed = await pixel(page, "keyed", SUBJECT);
    console.log(`[ultra-key] keyed screen=${screenKeyed} subject=${subjectKeyed}`);
    // Transparent: whatever sits under the clip shows through (another clip's picture here), never the green.
    expect(screenKeyed[1], "keyed screen no longer shows green").toBeLessThan(screenKeyed[0] + 20);
    expect(Math.abs(screenKeyed[1] - screenBefore[1]) + Math.abs(screenKeyed[0] - screenBefore[0]), "the screen pixel changed").toBeGreaterThan(60);
    for (let i = 0; i < 3; i++) expect(Math.abs(subjectKeyed[i] - subjectBefore[i]), `subject channel ${i}`).toBeLessThan(14);

    // Alpha channel output: the matte as grey (screen black, subject white); the colour channel shows the footage.
    await page.getByRole("group", { name: "Ultra Key output" }).getByRole("button", { name: "Alpha" }).click();
    await settle(page, 900);
    await snapUntil(page, "alpha", SCREEN, (px) => Math.max(...px) < 20);
    const alphaScreen = await pixel(page, "alpha", SCREEN);
    const alphaSubject = await pixel(page, "alpha", SUBJECT);
    expect(Math.max(...alphaScreen)).toBeLessThan(20);
    expect(Math.min(...alphaSubject)).toBeGreaterThan(235);
    await page.getByRole("group", { name: "Ultra Key output" }).getByRole("button", { name: "Color" }).click();
    await settle(page, 900);
    await snap(page, "color");
    expect((await pixel(page, "color", SCREEN))[1], "colour channel keeps the screen").toBeGreaterThan(60);
    await page.getByRole("group", { name: "Ultra Key output" }).getByRole("button", { name: "Composite" }).click();
    await settle(page, 700);

    // Eyedroppers are mutually exclusive: arming Ultra Key then White Balance disarms the key picker,
    // so the key output returns to the composite and the WB pick (not the key pick) takes the click.
    const monitor = (): string =>
      "(window.__openreelE2E.colorMonitor.getState())";
    await page.getByRole("button", { name: "Pick key color from the Program monitor" }).click();
    await page.getByTestId("ultra-key-picker-layer").waitFor();
    await settle(page, 600);
    await page.evaluate(
      (id) => (window as unknown as { __openreelE2E: { colorMonitor: { getState(): Record<string, any> } } }).__openreelE2E.colorMonitor.getState().setWhiteBalancePick({ clipId: id }),
      clipId,
    );
    await expect(page.getByTestId("ultra-key-picker-layer")).toHaveCount(0);
    await page.getByTestId("wb-eyedropper-layer").waitFor();
    expect(await page.evaluate(`${monitor()}.keyPicker`)).toBeNull();
    await settle(page, 900);
    await snapUntil(page, "after-wb-arm", SCREEN, (px) => px[1] < px[0] + 20);
    const screenAfterArm = await pixel(page, "after-wb-arm", SCREEN);
    expect(screenAfterArm[1], "key output is back to composite, not stuck on the source").toBeLessThan(screenAfterArm[0] + 20);
    const keyBeforeWb = (await ultraKeyEffects(page))[0].params;
    await page.mouse.click(box.x + box.width * SUBJECT.x, box.y + box.height * SUBJECT.y);
    await expect(page.getByTestId("wb-eyedropper-layer")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const g = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E.project.getState().getClip(id)?.colorGrading ?? {};
            return Math.abs(g.temperature ?? 0) + Math.abs(g.tint ?? 0);
          }, clipId),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const keyAfterWb = (await ultraKeyEffects(page))[0].params;
    expect(keyAfterWb.keyR, "the WB pick did not retarget the key colour").toBe(keyBeforeWb.keyR);
    expect(keyAfterWb.keyG).toBe(keyBeforeWb.keyG);

    // Keyframable: a diamond on a slider stores an effect-instance keyframe on the clip.
    await page.getByRole("button", { name: "Keyframe transparency" }).first().click();
    await settle(page, 400);
    const keyframes = await page.evaluate((id) => {
      const state = (window as unknown as { __openreelE2E: { project: { getState(): Record<string, any> } } }).__openreelE2E.project.getState();
      return (state.getClip(id)?.keyframes ?? []).map((k: { property: string }) => k.property);
    }, clipId);
    expect(keyframes).toContain(`fx:${fx.id}:transparency`);

    // The keyboard shortcut undoes Ultra Key edits too (not only the toolbar button): switch the output, blur, Ctrl/Cmd+Z.
    await page.getByRole("group", { name: "Ultra Key output" }).getByRole("button", { name: "Alpha" }).click();
    await settle(page, 500);
    const outputAfter = (await ultraKeyEffects(page))[0].params.output;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect
      .poll(async () => (await ultraKeyEffects(page))[0].params.output, { timeout: 10_000 })
      .not.toBe(outputAfter);
  });

  test("Ultra Key card previews the real key on your footage and is badged as a sample", async ({ page }) => {
    test.setTimeout(240_000);
    await openEditor(page);
    await seek(page, 0.2);
    await page.getByRole("button", { name: "Effects", exact: true }).first().click();
    await settle(page, 500);
    await page.getByRole("button", { name: "Keying", exact: true }).first().click();
    const canvas = page.locator('button[aria-label^="Ultra Key. Drag"] canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    await expect.poll(async () => canvas.getAttribute("data-preview-state"), { timeout: 60_000 }).toBe("poster");
    expect(await canvas.getAttribute("data-preview-source")).toBe("footage");
    await expect(page.locator('button[aria-label^="Ultra Key. Drag"] [aria-hidden="true"] span').first()).toHaveText("Sample key");
    // The card must show the footage keyed, not an empty checkerboard: plenty of distinct colours, not just the two checker tones.
    const colours = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const g = document.createElement("canvas");
      g.width = c.width;
      g.height = c.height;
      const ctx = g.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, g.width, g.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
      return seen.size;
    });
    expect(colours, "the card shows the subject, not just the checkerboard").toBeGreaterThan(12);
  });

  test("Ultra Key shader matches the CPU reference (WebGL2 path vs software / export path)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as unknown as { __openreelE2E?: unknown }).__openreelE2E));
    const report = await page.evaluate(() => {
      const hook = (window as unknown as { __openreelE2E: { secondary: Record<string, any>; core: { proEffects: Record<string, any> } } }).__openreelE2E;
      const e = hook.secondary;
      const defaults = hook.core.proEffects.PRO_EFFECT_DEFAULTS["ultra-key"] as Record<string, unknown>;
      const W = 192;
      const H = 108;
      // A lit green screen (brighter in the middle, noisy), a skin subject with a blue patch and a soft pale-green rim.
      const src = new Uint8ClampedArray(W * H * 4);
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 10;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const lit = 0.65 + 0.35 * Math.sin((x / W) * Math.PI) * Math.sin((y / H) * Math.PI);
          let px = [20 * lit, 180 * lit, 76 * lit];
          const dx = x - W / 2;
          const dy = y - H / 2;
          const r = Math.hypot(dx / 38, dy / 40);
          if (r < 1) px = [217, 160, 122];
          if (r < 1 && x < W / 2 - 8 && y < H / 2 - 10) px = [42, 63, 143];
          if (r >= 1 && r < 1.12) px = [150 + 60 * (r - 1) * 8, 200, 120]; // spill rim
          src.set([px[0] + rnd(), px[1] + rnd(), px[2] + rnd(), 255], (y * W + x) * 4);
        }
      const base = { keyR: 20, keyG: 180, keyB: 76 };
      const cases: Record<string, Record<string, unknown>> = {
        default: { ...defaults, ...base },
        "wide key": { ...base, transparency: 80, highlight: 30, shadow: 20, tolerance: 70, pedestal: 5, spill: 0, desaturate: 0, luma: 0 },
        "choke + soften": { ...base, transparency: 45, tolerance: 50, choke: 60, soften: 50, spill: 0, desaturate: 0, luma: 0 },
        "contrast + midpoint": { ...base, transparency: 60, tolerance: 40, contrast: 70, midPoint: 35, spill: 0, desaturate: 0, luma: 0 },
        "spill + colour correction": { ...base, spill: 100, range: 90, desaturate: 60, luma: 80, saturation: 130, hue: 20, luminance: 90 },
        "alpha channel": { ...base, output: "alpha", choke: 30, soften: 30 },
        "colour channel": { ...base, output: "color", spill: 80, range: 70, saturation: 80 },
      };
      const supported = Boolean(e.MotionShaderRenderer.isSupported());
      const renderer = supported ? new e.MotionShaderRenderer() : null;
      const rows: Array<Record<string, number | string>> = [];
      for (const [name, params] of Object.entries(cases)) {
        const full = { ...(params as Record<string, unknown>) };
        const cpu = new Uint8ClampedArray(src);
        e.applyProEffect("ultra-key", full, cpu, W, H);
        if (!renderer) {
          rows.push({ name, gpu: "unsupported" });
          continue;
        }
        const input = document.createElement("canvas");
        input.width = W;
        input.height = H;
        input.getContext("2d", { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(src), W, H), 0, 0);
        const out = renderer.render(e.PRO_EFFECT_SHADER_DEFS["ultra-key"], {
          width: W,
          height: H,
          time: 0,
          params: e.proEffectGpuUniforms("ultra-key", full, H),
          inputCanvas: input,
          strict: true,
        });
        if (!out) {
          rows.push({ name, gpu: "render-failed" });
          continue;
        }
        const c2 = document.createElement("canvas");
        c2.width = W;
        c2.height = H;
        const g2 = c2.getContext("2d", { willReadFrequently: true })!;
        g2.drawImage(out, 0, 0, W, H);
        const gpu = g2.getImageData(0, 0, W, H).data;
        let alphaSum = 0;
        let alphaOver = 0;
        let rgbSum = 0;
        let rgbN = 0;
        let rgbOver = 0;
        let transparent = 0;
        for (let i = 0; i < gpu.length; i += 4) {
          const da = Math.abs(gpu[i + 3] - cpu[i + 3]);
          alphaSum += da;
          if (da > 3) alphaOver++;
          if (cpu[i + 3] < 8) transparent++;
          // Colour is only meaningful where the pixel is visible (premultiplied storage loses it below that).
          if (cpu[i + 3] >= 200 && gpu[i + 3] >= 200)
            for (let k = 0; k < 3; k++) {
              const d = Math.abs(gpu[i + k] - cpu[i + k]);
              rgbSum += d;
              rgbN++;
              if (d > 3) rgbOver++;
            }
        }
        const px = W * H;
        rows.push({ name, gpu: "ok", alphaMean: alphaSum / px, alphaOver: alphaOver / px, rgbMean: rgbN ? rgbSum / rgbN : 0, rgbOver: rgbN ? rgbOver / rgbN : 0, transparent: transparent / px });
      }
      return { supported, rows };
    });
    console.log(`[ultra-key] shader parity (WebGL2 supported=${report.supported})\n` + report.rows.map((r) => JSON.stringify(r)).join("\n"));
    test.skip(!report.supported, "WebGL2 unavailable in this browser: the CPU reference is the only path here");
    for (const row of report.rows) {
      expect(row.gpu, String(row.name)).toBe("ok");
      expect(row.alphaMean as number, `${row.name} mean alpha diff`).toBeLessThan(0.8);
      expect(row.alphaOver as number, `${row.name} share of alpha off by more than 3`).toBeLessThan(0.004);
      expect(row.rgbMean as number, `${row.name} mean colour diff`).toBeLessThan(0.8);
      expect(row.rgbOver as number, `${row.name} share of channels off by more than 3`).toBeLessThan(0.004);
    }
    // The cases must actually key something (guards against comparing two no-ops).
    expect(report.rows.find((r) => r.name === "default")?.transparent as number).toBeGreaterThan(0.3);
  });
}
