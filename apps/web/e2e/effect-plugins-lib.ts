import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { createStoredZip } from "../../../packages/core/src/plugins/zip";
import { openHookPage } from "./helpers";

export const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples/effect-plugins");
export const OUT = join(tmpdir(), `openreel-plugin-e2e-${process.pid}`);

export function ensurePluginOutDir(): void {
  mkdirSync(OUT, { recursive: true });
}

/** Zip an example plugin folder into a .orplugin file and return its path. */
export function pack(id: string, overrides: Record<string, string> = {}): string {
  const dir = join(EXAMPLES, id);
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) files[name] = readFileSync(join(dir, name), "utf8");
  const path = join(OUT, `${id}${Object.keys(overrides).length ? "-custom" : ""}.orplugin`);
  writeFileSync(path, createStoredZip({ ...files, ...overrides }));
  return path;
}

export function packRaw(name: string, files: Record<string, string>): string {
  const path = join(OUT, name);
  writeFileSync(path, createStoredZip(files));
  return path;
}

export async function openManager(page: Page): Promise<void> {
  const menubar = page.getByRole("menubar", { name: "Application menu" });
  await menubar.getByText("Effects", { exact: true }).click();
  await page.getByRole("menuitem", { name: /Manage plugins/ }).click();
  await page.getByRole("dialog", { name: "Manage Plugins" }).waitFor();
}

export async function openManagerFromHook(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__openreelE2E.plugins.manager.getState().setOpen(true));
  await page.getByRole("dialog", { name: "Manage Plugins" }).waitFor();
}

/** Choose a file in the manager like a user does and wait for the install report to mention `expected`. */
export async function uploadPlugin(page: Page, file: string, expected: string | RegExp): Promise<void> {
  await page.getByTestId("plugin-file-input").setInputFiles(file);
  await expect(page.getByTestId("plugin-install-report")).toContainText(expected, { timeout: 20_000 });
}

export async function closeManager(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Manage Plugins" }).waitFor({ state: "hidden" });
}

/**
 * Hook-page flow shared by the GPU spec and the no-WebGPU fallback specs: install the two WGSL example
 * plugins through the manager, then render them. With a WebGPU adapter the shaders must compile (a broken one
 * is refused with its own line number) and really run; without one the prism (no CPU fallback) is bypassed,
 * never a crash, and film grain falls back to its sandboxed CPU implementation.
 */
export async function runWgslPluginFlow(page: Page): Promise<{ hasAdapter: boolean }> {
  await openHookPage(page);
  // requestAdapter can return null for a moment while many GPU clients start at once (a loaded multi-worker
  // run): ask a few times, each bounded, before concluding there is none.
  const hasAdapter = await page.evaluate(async () => {
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const adapter = await Promise.race([
        gpu.requestAdapter().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (adapter) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  });
  console.log(`[plugins] WebGPU adapter available: ${hasAdapter}`);
  await openManagerFromHook(page);

  if (hasAdapter) {
    // A shader with a syntax error is refused with the plugin's own line number.
    const broken = packRaw("broken-shader.orplugin", {
      "plugin.json": JSON.stringify({
        apiVersion: 1,
        id: "broken-shader",
        name: "Broken Shader",
        version: "1.0.0",
        category: "Stylize",
        parameters: [],
        shader: { file: "shader.wgsl" },
      }),
      "shader.wgsl": "fn effect(uv: vec2<f32>, src: vec4<f32>) -> vec4<f32> {\n  let x: f32 = ;\n  return src;\n}\n",
    });
    await uploadPlugin(page, broken, "could not be installed");
    const report = page.getByTestId("plugin-install-report");
    await expect(report).toHaveAttribute("role", "alert");
    await expect(report).toContainText("WGSL compile error");
    await expect(report).toContainText(/line 2/);
    await expect(page.getByTestId("plugin-row-broken-shader")).toHaveCount(0);
  }

  await uploadPlugin(page, pack("chromatic-aberration-prism"), "Installed Prism Aberration v1.2.0");
  await uploadPlugin(page, pack("film-grain"), "Installed Film Grain Pro v1.0.0");
  await closeManager(page);

  const result = await page.evaluate(async (adapter) => {
    const { registry, host } = (window as any).__openreelE2E.plugins;
    const W = 160;
    const H = 90;
    const canvas = (draw: (g: OffscreenCanvasRenderingContext2D) => void) => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext("2d", { willReadFrequently: true })!;
      draw(g);
      return g;
    };
    const px = (g: OffscreenCanvasRenderingContext2D, x: number, y: number) => Array.from(g.getImageData(x, y, 1, 1).data);

    // Prism: hard white|black edge at x = 80. Red samples ahead (+x), blue behind (-x).
    const prism = canvas((g) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W / 2, H);
      g.fillStyle = "#000";
      g.fillRect(W / 2, 0, W / 2, H);
    });
    const prismEffect = { type: "plugin:chromatic-aberration-prism", params: { amount: 12, angle: 0, falloff: 0, channels: "rb", center: { x: 0.5, y: 0.5 } } };
    const prismResult = await host.applyToContext(prism, prismEffect, W, H);
    // Film grain: flat mid grey, different frames must differ, amount 0 must not.
    const grainOf = async (time: number, amount: number) => {
      const g = canvas((c) => {
        c.fillStyle = "#808080";
        c.fillRect(0, 0, W, H);
      });
      const r = await host.applyToContext(g, { type: "plugin:film-grain", params: { amount, size: 1, midtones: 0, colored: false, __time: time } }, W, H);
      return { r, data: g.getImageData(0, 0, W, H).data };
    };
    const g1 = await grainOf(0.1, 0.5);
    const g2 = await grainOf(0.5, 0.5);
    const g0 = await grainOf(0.1, 0);
    const spread = (d: Uint8ClampedArray) => {
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        min = Math.min(min, d[i]);
        max = Math.max(max, d[i]);
      }
      return max - min;
    };
    let framesDiffer = 0;
    for (let i = 0; i < g1.data.length; i += 4) if (g1.data[i] !== g2.data[i]) framesDiffer++;
    const sameAgain = (await grainOf(0.1, 0.5)).data;
    let repeatable = true;
    for (let i = 0; i < sameAgain.length; i++) if (sameAgain[i] !== g1.data[i]) repeatable = false;
    return {
      prismResult,
      onWhiteSide: px(prism, 80 - 4, 45),
      onBlackSide: px(prism, 80 + 4, 45),
      far: px(prism, 10, 45),
      grain: { r: g1.r, spread: spread(g1.data), framesDiffer, repeatable, zeroSpread: spread(g0.data) },
      health: registry.getHealth("chromatic-aberration-prism"),
      adapter,
    };
  }, hasAdapter);
  console.log(`[plugins] gpu result ${JSON.stringify({ ...result, grain: result.grain })}`);

  if (hasAdapter) {
    expect(result.prismResult).toEqual({ applied: true, backend: "gpu" });
    // White side next to the edge: red read from the black side (dark), green/blue still white.
    expect(result.onWhiteSide[0]).toBeLessThan(120);
    expect(result.onWhiteSide[1]).toBeGreaterThan(200);
    // Black side next to the edge: blue read from the white side, red/green stay black.
    expect(result.onBlackSide[2]).toBeGreaterThan(120);
    expect(result.onBlackSide[0]).toBeLessThan(40);
    // Far from the edge nothing moves.
    expect(result.far.slice(0, 3)).toEqual([255, 255, 255]);
    expect(result.grain.r).toEqual({ applied: true, backend: "gpu" });
    expect(result.grain.spread).toBeGreaterThan(20);
    expect(result.grain.framesDiffer).toBeGreaterThan(1000);
    expect(result.grain.repeatable, "grain is a pure function of (pixel, frame): preview == export").toBe(true);
    expect(result.grain.zeroSpread).toBe(0);
    expect(result.health.state).toBe("ok");
  } else {
    // No WebGPU: the prism has no CPU fallback, so it is bypassed (frame untouched), never a crash.
    expect(result.prismResult).toMatchObject({ applied: false, reason: "failed" });
    expect(result.far.slice(0, 3)).toEqual([255, 255, 255]);
    // Film grain ships a CPU fallback: it still renders, in the sandboxed worker.
    expect(result.grain.r).toEqual({ applied: true, backend: "cpu" });
    expect(result.grain.spread).toBeGreaterThan(20);
    expect(result.health.error).toMatch(/WebGPU/);
  }

  await openManagerFromHook(page);
  for (const name of ["Prism Aberration", "Film Grain Pro"]) {
    await page.getByRole("button", { name: `Uninstall ${name}` }).click();
  }
  await expect(page.getByTestId("plugin-empty")).toBeVisible();
  return { hasAdapter };
}
