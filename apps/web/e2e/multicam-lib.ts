import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FPS, clipsOf, importInput, readState, settle } from "./helpers";
import { E2E_FFMPEG, E2E_FFPROBE } from "./env";

/**
 * Shared multicam flow, run against GPU Chrome and against the software
 * renderer. Three cameras are generated with ffmpeg: solid red / green / blue
 * pictures that start at known moments of one shared timeline and hear the
 * same noise bursts ("claps") through differently coloured microphones.
 */
const FFMPEG = E2E_FFMPEG;
const FFPROBE = E2E_FFPROBE;
export const SIZE = { width: 640, height: 360 };
const RATE = 48000;
export const CLAPS = [2.0, 3.7, 5.2, 7.9, 9.3, 11.0];

/** Shared-time second at which each camera's media time 0 plays. Angle 1 is the reference. */
export const CAMERAS = [
  { file: "cam-red.mp4", color: "red", rgb: [255, 0, 0], offset: 0, filter: "anull" },
  { file: "cam-green.mp4", color: "green", rgb: [0, 200, 0], offset: 1.2, filter: "lowpass=f=3000" },
  { file: "cam-blue.mp4", color: "blue", rgb: [0, 0, 255], offset: 0.55, filter: "volume=0.6,highpass=f=300" },
] as const;
const CAMERA_SECONDS = 12;

export interface Hook {
  project: { getState(): Record<string, any> };
  timeline: { getState(): Record<string, any> };
  multicam: { getState(): Record<string, any> };
  ui: { getState(): Record<string, any> };
  exportQueue: { getState(): Record<string, any> };
}
export const E = (page: Page) => page;

let generated: string | null = null;
/** Generate the camera files once per run (deterministic content). */
export function generateCameras(): string {
  if (generated) return generated;
  const dir = mkdtempSync(join(tmpdir(), "openreel-multicam-"));
  mkdirSync(dir, { recursive: true });
  // Master sound: seeded noise bursts on a quiet bed, 20 s of shared time.
  const total = 20 * RATE;
  const pcm = Buffer.alloc(total * 2);
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  const samples = new Int16Array(total);
  for (let i = 0; i < total; i++) samples[i] = Math.round(rand() * 400);
  for (const clap of CLAPS) {
    const start = Math.round(clap * RATE);
    for (let i = 0; i < 0.09 * RATE; i++) samples[start + i] += Math.round(rand() * 2 * 24000 * Math.exp(-i / (0.02 * RATE)));
  }
  for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const master = join(dir, "master.wav");
  writeFileSync(master, Buffer.concat([header, pcm]));
  for (const cam of CAMERAS) {
    execFileSync(
      FFMPEG,
      [
        "-y",
        "-f", "lavfi", "-i", `color=c=${cam.color}:size=${SIZE.width}x${SIZE.height}:rate=${FPS}:duration=${CAMERA_SECONDS}`,
        "-ss", String(cam.offset), "-t", String(CAMERA_SECONDS), "-i", master,
        "-af", cam.filter,
        "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest",
        join(dir, cam.file),
      ],
      { stdio: "ignore" },
    );
  }
  generated = dir;
  return dir;
}

export const cameraPath = (index: number): string => join(generateCameras(), CAMERAS[index].file);

/** A bare editor (no clip on the timeline) with the three cameras imported. */
export async function openMulticamEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable; the tour just shows */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 60_000 });
  await page.evaluate(async (size) => {
    const h = (window as unknown as { __openreelE2E: Hook }).__openreelE2E;
    await h.project.getState().updateSettings({ width: size.width, height: size.height });
  }, SIZE);
  await importInput(page).setInputFiles(CAMERAS.map((_, i) => cameraPath(i)));
  for (const cam of CAMERAS) await page.getByLabel(`Select media ${cam.file}`).waitFor({ timeout: 60_000 });
  await settle(page, 500);
}

export interface MulticamClip {
  id: string;
  start: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  reversed: boolean;
  mediaId: string;
  media: string;
  angle: number;
  tagged: boolean;
}

/** Every video clip of the live timeline with its camera name and multicam tag. */
export async function readCuts(page: Page): Promise<MulticamClip[]> {
  return page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    const sources = p.multicamSources ?? [];
    const out: Array<Record<string, unknown>> = [];
    for (const track of p.timeline.tracks) {
      if (track.type !== "video") continue;
      for (const clip of track.clips) {
        const tag = clip.metadata?.multicam;
        const source = tag ? sources.find((s: any) => s.id === tag.sourceId) : undefined;
        const index = source ? source.angles.findIndex((a: any) => a.id === tag.angleId) : -1;
        out.push({
          id: clip.id,
          start: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          speed: clip.speed ?? 1,
          reversed: !!clip.reversed,
          mediaId: clip.mediaId,
          media: p.mediaLibrary.items.find((m: any) => m.id === clip.mediaId)?.name ?? "",
          angle: index + 1,
          tagged: !!tag,
        });
      }
    }
    return (out as unknown as MulticamClip[]).sort((a, b) => a.start - b.start);
  });
}

export const historyLength = async (page: Page): Promise<number> => (await readState(page)).historyLength;

/** Full structural snapshot for exact undo/redo comparisons. */
export async function snapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const p = (window as unknown as { __openreelE2E: Hook }).__openreelE2E.project.getState().project;
    return JSON.stringify({
      tracks: p.timeline.tracks.map((t: any) => ({ id: t.id, type: t.type, name: t.name, clips: t.clips })),
      sources: p.multicamSources ?? null,
      duration: p.timeline.duration,
    });
  });
}

export async function openCreateDialog(page: Page): Promise<void> {
  await page.getByRole("menubar", { name: "Application menu" }).getByText("Sequence", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Create multi-camera source…" }).click();
  await page.getByTestId("multicam-source-dialog").waitFor();
}

/** Mean RGB of the decoded frame at `time` of a file, via ffmpeg. */
export function frameColor(file: string, time: number): [number, number, number] {
  const raw = execFileSync(
    FFMPEG,
    ["-v", "error", "-ss", time.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 20 },
  );
  return [raw[0], raw[1], raw[2]];
}

export function nearestCamera(rgb: readonly number[]): string {
  let best = "";
  let distance = Infinity;
  for (const cam of CAMERAS) {
    const d = cam.rgb.reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = cam.color;
    }
  }
  return best;
}

export function probeDuration(file: string): number {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

/** Wait until the timeline playhead has passed `time`, polling the live store. */
export async function waitForPlayhead(page: Page, time: number, timeoutMs = 30_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = await page.evaluate(() => (window as unknown as { __openreelE2E: Hook }).__openreelE2E.timeline.getState().playheadPosition as number);
    if (now >= time) return now;
    if (Date.now() > deadline) throw new Error(`playhead never reached ${time}s (stuck at ${now}s)`);
    await page.waitForTimeout(15);
  }
}

export { expect, clipsOf };
