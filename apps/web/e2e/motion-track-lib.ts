import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { E2E_FFMPEG } from "./env";
import { clipsOf, importInput, readState, settle } from "./helpers";

/**
 * Shared motion-tracking fixtures and helpers. A textured sprite (blue/grey tiles, no red anywhere)
 * moves over a static textured background along a path both ffmpeg and the spec compute from the same
 * formulas, so every pixel assertion compares against the TRUE target position, not against another
 * tracker output.
 */
const FFMPEG = E2E_FFMPEG;
export const SIZE = { width: 640, height: 360 };
export const SPRITE = 96;
export const FRAMES = 120;
export const FPS = 30;

/**
 * Centre of the sprite at frame n. ffmpeg's overlay evaluates `n` one ahead of the output frame index
 * (verified by measuring the rendered sprite), so the true position of output frame n is the formula at n+1:
 * slow, a fast burst (24 px/frame) at output frames 38-48, slow back.
 */
export function targetAt(frame: number): { x: number; y: number } {
  const n = frame + 1;
  const x = n < 40 ? 100 + 4 * n : n < 50 ? 256 + 24 * (n - 39) : 496 - 2 * (n - 49);
  return { x, y: 180 + 50 * Math.sin(n / 15) };
}
const X_EXPR = "if(lt(n,40),100+4*n,if(lt(n,50),256+24*(n-39),496-2*(n-49)))";
const Y_EXPR = "180+50*sin(n/15)";

export type Variant = "clean" | "occluded";
/** Frames where the sprite is completely hidden / partly hidden in the occluded variant. */
export const FULL_OCCLUSION = { from: 60, to: 69 };
export const PARTIAL_OCCLUSION = { from: 80, to: 89 };

let dir: string | null = null;
const made: Partial<Record<Variant, string>> = {};

export function generateTrackClip(variant: Variant): string {
  if (made[variant]) return made[variant]!;
  dir ??= mkdtempSync(join(tmpdir(), "openreel-motion-track-"));
  mkdirSync(dir, { recursive: true });
  const out = join(dir, variant === "clean" ? "track-clean.mp4" : "track-occluded.mp4");
  const background = "nullsrc=s=640x360:r=30:d=4,geq=lum='70+mod(floor(X/4)*floor(X/4)*3+floor(Y/4)*floor(Y/4)*5+floor(X/4)*floor(Y/4)*7,37)':cb=128:cr=128";
  const sprite = "nullsrc=s=96x96:r=30:d=4,geq=lum='40+170*mod(floor(X/5)*floor(X/5)*3+floor(Y/5)*floor(Y/5)*7+floor(X/5)*floor(Y/5)*11,13)/12':cb='100+90*mod(floor(X/12)+floor(Y/12),2)':cr=108";
  let graph = `[0:v][1:v]overlay=x='(${X_EXPR})-48':y='(${Y_EXPR})-48':eval=frame[a]`;
  if (variant === "occluded") {
    graph += `;[a]drawbox=x=380:y=40:w=190:h=300:color=0x808080:t=fill:enable='between(n,${FULL_OCCLUSION.from},${FULL_OCCLUSION.to})'[b]`;
    graph += `;[b]drawbox=x=380:y=40:w=40:h=300:color=0x808080:t=fill:enable='between(n,${PARTIAL_OCCLUSION.from},${PARTIAL_OCCLUSION.to})'[v]`;
  } else graph += ";[a]null[v]";
  execFileSync(FFMPEG, ["-y", "-f", "lavfi", "-i", background, "-f", "lavfi", "-i", sprite, "-filter_complex", graph, "-map", "[v]",
    "-c:v", "libx264", "-crf", "12", "-g", "15", "-pix_fmt", "yuv420p", "-frames:v", String(FRAMES), out], { stdio: "ignore" });
  made[variant] = out;
  return out;
}

let hd: string | null = null;
/** The clean clip at 1920x1080 (every coordinate x3), for the 1080p tracking-speed measurement. */
export function generateTrackClip1080(): string {
  if (hd) return hd;
  const src = generateTrackClip("clean");
  const out = src.replace("track-clean.mp4", "track-1080p.mp4");
  execFileSync(FFMPEG, ["-y", "-i", src, "-vf", "scale=1920:1080:flags=bicubic", "-c:v", "libx264", "-crf", "14", "-g", "15", "-pix_fmt", "yuv420p", out], { stdio: "ignore" });
  hd = out;
  return out;
}

export interface Hook {
  project: { getState(): Record<string, any>; setState(value: unknown): void };
  timeline: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
}
export const E = "window.__openreelE2E";

/** Fresh editor with `file` on the Main track (project matched to the clip: 640x360 @ 30). */
export async function openEditorWith(page: Page, file: string, name: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch { /* storage unavailable; the tour just shows */ }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await importInput(page).setInputFiles(file);
  await page.getByLabel(`Select media ${name}`).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: `Media actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Add to timeline" }).click();
  await page.getByRole("button", { name: "Match Video" }).click({ timeout: 8_000 }).catch(() => undefined);
  await expect.poll(async () => clipsOf(await readState(page), "Main").length, { timeout: 20_000 }).toBe(1);
  await settle(page);
}

/** The saved analysis (or null) of a clip, read straight from the project store. */
export function readTrack(page: Page, clipId: string) {
  return page.evaluate((id) => {
    const project = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const clip = project.timeline.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const saved = clip?.metadata?.workspaceMotionTrackingAnalysis;
    return saved ? (JSON.parse(JSON.stringify(saved)) as { data: TrackData }) : null;
  }, clipId);
}

export interface TrackData {
  keyframes: Array<{ frame: number; position: { x: number; y: number }; scale?: number }>;
  confidence: number[];
  lostFrames: number[];
  states?: string[];
  manualFrames?: number[];
  stats?: { frames: number; elapsedMs: number; framesPerSecond: number; decodeMs: number; trackMs: number };
}

export interface Centroid { x: number; y: number; count: number }

/**
 * One exported frame (scaled to the project size): centroid of the pure-red pixels (the attached shape)
 * and of the saturated blue/green sprite pixels (the target, visible around and under the small shape).
 * Either is null when fewer than 20 pixels match (shape absent / sprite hidden).
 */
export function exportedCentroids(file: string, seconds: number): { red: Centroid | null; sprite: Centroid | null } {
  const { width, height } = SIZE;
  const buf = execFileSync(FFMPEG, ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
  expect(buf.length, "decoded frame size").toBe(width * height * 3);
  const sums = { red: [0, 0, 0], sprite: [0, 0, 0] };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 3, r = buf[o], g = buf[o + 1], b = buf[o + 2];
    const bucket = r > 200 && g < 70 && b < 70 ? sums.red : Math.max(r, g, b) - Math.min(r, g, b) > 40 ? sums.sprite : null;
    if (bucket) { bucket[0] += x; bucket[1] += y; bucket[2]++; }
  }
  const out = (v: number[]): Centroid | null => (v[2] > 20 ? { x: v[0] / v[2], y: v[1] / v[2], count: v[2] } : null);
  return { red: out(sums.red), sprite: out(sums.sprite) };
}
