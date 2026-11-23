import { expect, test } from "@playwright/test";
import { clipsOf, openEditor, readState, settle } from "./helpers";

/**
 * The VR effects runtime (CPU reference, GLSL, shader uniforms, about 23 KB) is a lazy chunk. The e2e hook normally
 * preloads it so the pixel-parity specs can drive the effects directly; here the page sets `__openreelLazyVr` first, so
 * the hook leaves it alone and the product's own path is what runs:
 *  - nothing VR-heavy is requested at cold start or when the editor opens;
 *  - adding a VR effect and rendering the very first frame waits for the chunk and then draws WITH the effect
 *    (never an unprocessed frame), for the preview path and the export-mode path;
 *  - a project that already holds a VR effect is preloaded by the Program monitor before any render is asked for.
 */
interface Hook {
  project: { getState: () => any };
  video: { getVideoEngine: () => any };
  core: { vrRuntime: { isLoaded: () => boolean } };
}


test("VR runtime is lazy: loads on first VR render and the first frame has the effect", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    (window as unknown as { __openreelLazyVr?: boolean }).__openreelLazyVr = true;
  });
  const requested: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/vr-runtime-/.test(url)) requested.push(url);
  });

  await openEditor(page);
  await settle(page, 1500);
  expect(await page.evaluate(() => (window as any).__openreelE2E.core.vrRuntime.isLoaded()), "not loaded when the editor opens").toBe(false);
  expect(requested, "no VR runtime chunk requested at cold start (the spherical metadata reader loads only when an MP4 / MOV is probed)").toEqual([]);

  const [clip] = clipsOf(await readState(page), "Main");
  // Add the effect (not yet neutral), then render the first frame with it: the render itself must trigger the load.
  await page.evaluate(
    async (id) => {
      const e = (window as any).__openreelE2E as Hook;
      const store = e.project.getState();
      await store.addVideoEffect(id, "vr-rotate-sphere", { pan: 90, tilt: 0, roll: 0, layout: "mono" });
    },
    clip.id,
  );
  // Adding is a project change: the Program monitor preloads on its own, but the check below must not depend on that,
  // so it asserts on what rendering does and (separately) that the chunk ended up requested exactly once.
  const rendered = await page.evaluate(
    async (id) => {
      const e = (window as any).__openreelE2E as Hook;
      const engine = e.video.getVideoEngine();
      const project = e.project.getState().project;
      const stripped = {
        ...project,
        timeline: { ...project.timeline, tracks: project.timeline.tracks.map((tr: any) => ({ ...tr, clips: tr.clips.map((c: any) => ({ ...c, effects: [] })) })) },
      };
      const read = async (p: unknown, exportMode: boolean) => {
        engine.exportMode = exportMode;
        try {
          const frame = await engine.renderFrame(p, 0.5, 320, 160);
          const canvas = new OffscreenCanvas(frame.image.width, frame.image.height);
          const g = canvas.getContext("2d", { willReadFrequently: true })!;
          g.drawImage(frame.image, 0, 0);
          return Array.from(g.getImageData(0, 0, canvas.width, canvas.height).data);
        } finally {
          engine.exportMode = false;
        }
      };
      const plain = await read(stripped, false);
      const withEffectPreview = await read(project, false);
      const withEffectExport = await read(project, true);
      const diff = (a: number[], b: number[]) => {
        let d = 0;
        for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        return d / (a.length / 4);
      };
      return { loaded: e.core.vrRuntime.isLoaded(), vsPlainPreview: diff(plain, withEffectPreview), vsPlainExport: diff(plain, withEffectExport), previewVsExport: diff(withEffectPreview, withEffectExport), id };
    },
    clip.id,
  );
  expect(rendered.loaded, "the render loaded the runtime").toBe(true);
  expect(rendered.vsPlainPreview, "preview frame has the rotation applied (a 90 degree pan moves the picture)").toBeGreaterThan(4);
  expect(rendered.vsPlainExport, "export-mode frame has the rotation applied").toBeGreaterThan(4);
  expect(rendered.previewVsExport, "preview and export-mode frames agree").toBeLessThan(0.5);
  expect(requested.filter((url) => /vr-runtime-/.test(url)).length, "the runtime chunk is requested once").toBe(1);

});

test("a VR effect on a clip makes the Program monitor preload the runtime before any render is requested", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    (window as unknown as { __openreelLazyVr?: boolean }).__openreelLazyVr = true;
  });
  await openEditor(page);
  await settle(page, 1000);
  expect(await page.evaluate(() => (window as any).__openreelE2E.core.vrRuntime.isLoaded())).toBe(false);
  const [clip] = clipsOf(await readState(page), "Main");
  await page.evaluate(async (id) => {
    await (window as any).__openreelE2E.project.getState().addVideoEffect(id, "vr-blur", { radius: 3 });
  }, clip.id);
  await expect.poll(() => page.evaluate(() => (window as any).__openreelE2E.core.vrRuntime.isLoaded()), { timeout: 20_000 }).toBe(true);
});
