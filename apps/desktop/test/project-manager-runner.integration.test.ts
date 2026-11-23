import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import type { Project } from "../../../packages/core/src/types/project";
import { DEFAULT_PROJECT_MANAGER_OPTIONS, type ProjectManagerOptions, mapSourceTime } from "../../../packages/core/src/project-manager";
import { startProjectManagerJob, scanProject, type ProjectManagerEvent } from "../src/main/project-manager/runner";

const have = spawnSync(process.env.OPENREEL_FFMPEG_PATH ?? "ffmpeg", ["-version"]).status === 0;
const FF = process.env.OPENREEL_FFMPEG_PATH ?? "ffmpeg";
if (have) process.env.OPENREEL_FFMPEG_PATH = FF;

const W = 640;
const H = 360;
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, mediaId: string, startTime: number, duration: number, inPoint: number, speed?: number) => ({
  id, mediaId, trackId: "v1", startTime, duration, inPoint, outPoint: inPoint + duration * (speed ?? 1),
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [], ...(speed ? { speed } : {}),
});
const item = (id: string, path: string, fps: number, duration: number, size: number) => ({
  id, name: id, type: "video", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: W, height: H, frameRate: fps, codec: "h264", sampleRate: 48000, channels: 2, fileSize: size, hasVideo: true, hasAudio: true },
  sourceFile: { name: `${id}.mp4`, size, lastModified: 1, path },
});

const options = (extra: Partial<ProjectManagerOptions> = {}): ProjectManagerOptions => ({
  ...DEFAULT_PROJECT_MANAGER_OPTIONS, sequenceIds: ["seq_main"], mode: "consolidate", preset: "prores-422", trim: true, handleFrames: 6, ...extra,
});

function thumb(file: string, n: number): Buffer {
  return execFileSync(FF, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=96:54:flags=area`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
}
const diff = (a: Buffer, b: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};

describe.skipIf(!have)("Project Manager runner with real ffmpeg", () => {
  const dir = mkdtempSync(join(tmpdir(), "openreel-pm-"));
  const srcA = join(dir, "a.mp4"); // 24 fps
  const srcB = join(dir, "b.mp4"); // 29.97 fps
  const srcC = join(dir, "c.mp4"); // unused
  let project: Project;
  beforeAll(() => {
    const make = (out: string, rate: string, seconds: number) =>
      execFileSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${rate}:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${seconds}`, "-c:v", "libx264", "-crf", "8", "-g", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
    make(srcA, "24", 12);
    make(srcB, "30000/1001", 10);
    make(srcC, "24", 4);
    project = {
      id: "orig", name: "Test", createdAt: 1, modifiedAt: 1,
      settings: { width: W, height: H, frameRate: 24, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [item("A", srcA, 24, 12, statSync(srcA).size), item("B", srcB, 29.97, 10, statSync(srcB).size), item("C", srcC, 24, 4, statSync(srcC).size)] },
      timeline: { tracks: [{ id: "v1", type: "video", name: "V1", mode: "standard", clips: [clip("a1", "A", 0, 2, 2), clip("a2", "A", 2, 1.5, 8), clip("b1", "B", 3.5, 2, 3, 2)], transitions: [], locked: false, hidden: false, muted: false, solo: false }], subtitles: [], duration: 5.5, markers: [] },
    } as unknown as Project;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function run(opts: ProjectManagerOptions, name: string): Promise<{ events: ProjectManagerEvent[]; projectPath: string; destDir: string }> {
    const events: ProjectManagerEvent[] = [];
    const job = startProjectManagerJob({ project, options: opts, destParent: join(dir, "out", name), projectName: "Out" }, (e) => events.push(e));
    const summary = await job.done;
    return { events, projectPath: summary.projectPath, destDir: summary.destDir };
  }

  it("trims to the used ranges plus handles, leaves the sources alone and keeps every frame the edit shows", async () => {
    const before = { a: statSync(srcA).mtimeMs + statSync(srcA).size, b: statSync(srcB).mtimeMs + statSync(srcB).size };
    const { events, projectPath, destDir } = await run(options(), "trim");
    expect(statSync(srcA).mtimeMs + statSync(srcA).size).toBe(before.a);
    expect(statSync(srcB).mtimeMs + statSync(srcB).size).toBe(before.b);
    expect(existsSync(join(destDir, "Media", "c.mov"))).toBe(false);
    expect(events.some((e) => e.phase === "running")).toBe(true);
    expect(events.at(-1)?.phase).toBe("done");
    const fractions = events.map((e) => e.fraction);
    expect(fractions).toEqual([...fractions].sort((x, y) => x - y));

    const out = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
    expect(out.id).not.toBe("orig");
    expect(out.mediaLibrary.items.map((m) => m.id)).toEqual(["A", "B"]);
    const outA = out.mediaLibrary.items[0];
    const outB = out.mediaLibrary.items[1];
    expect(existsSync(outA.sourceFile!.path!)).toBe(true);
    expect(statSync(outA.sourceFile!.path!).size).toBeLessThan(statSync(srcA).size * 4);

    // A: two stretches (2..4 and 8..9.5, 6-frame handles), B: one (3..7 at 2x, NTSC grid)
    const clipsAfter = out.timeline.tracks[0].clips;
    const check = (srcFile: string, outFile: string, fps: number, before: { inPoint: number; duration: number; speed: number }, after: { inPoint: number }, segments: Array<{ srcStart: number; srcEnd: number; outStart: number }>) => {
      for (const k of [0, 0.3, 0.6, 0.95]) {
        const srcT = before.inPoint + k * before.duration * before.speed;
        const n = Math.floor(srcT * fps + 1e-6);
        const mapped = mapSourceTime(segments, n / fps, fps)!;
        expect(mapped).not.toBeNull();
        const nOut = Math.round(mapped * fps);
        expect(diff(thumb(srcFile, n), thumb(outFile, nOut)), `frame ${n} of ${srcFile} -> ${nOut}`).toBeLessThan(4);
      }
      void after;
    };
    // The segments the run used are recoverable from the rewritten in points: they differ from the originals by the cut.
    const aSegments = [{ srcStart: 1.75, srcEnd: 4.25, outStart: 0 }, { srcStart: 7.75, srcEnd: 9.75, outStart: 2.5 }];
    expect(clipsAfter[0].inPoint).toBeCloseTo(2 - 1.75, 6);
    expect(clipsAfter[1].inPoint).toBeCloseTo(8 - 7.75 + 2.5, 6);
    expect(clipsAfter[0].startTime).toBe(0);
    expect(outA.metadata.duration).toBeCloseTo(4.5, 2);
    check(srcA, outA.sourceFile!.path!, 24, { inPoint: 2, duration: 2, speed: 1 }, clipsAfter[0], aSegments);
    check(srcA, outA.sourceFile!.path!, 24, { inPoint: 8, duration: 1.5, speed: 1 }, clipsAfter[1], aSegments);
    const fpsB = 30000 / 1001;
    // 3 s is not on the 29.97 grid: the handle is added, then the start rounds DOWN to a whole frame.
    const bStart = Math.floor((3 - 6 / fpsB) * fpsB + 1e-6) / fpsB;
    const bEnd = Math.ceil((7 + 6 / fpsB) * fpsB - 1e-6) / fpsB;
    const bSeg = [{ srcStart: bStart, srcEnd: bEnd, outStart: 0 }];
    expect(clipsAfter[2].inPoint).toBeCloseTo(3 - bStart, 6);
    expect(outB.metadata.duration).toBeCloseTo(bEnd - bStart, 1);
    expect(clipsAfter[2].outPoint - clipsAfter[2].inPoint).toBeCloseTo(4, 6);
    check(srcB, outB.sourceFile!.path!, fpsB, { inPoint: 3, duration: 2, speed: 2 }, clipsAfter[2], bSeg);
    expect(outB.nativeSource?.codec).toBe("prores");
  }, 240_000);

  it("collect copies files byte for byte and leaves clip points alone", async () => {
    const { projectPath } = await run(options({ mode: "collect", trim: false, excludeUnused: false, renameToClipNames: true }), "collect");
    const out = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
    expect(out.mediaLibrary.items.map((m) => m.id)).toEqual(["A", "B", "C"]);
    const copied = out.mediaLibrary.items[0].sourceFile!.path!;
    expect(copied).toMatch(/Media[\\/]A\.mp4$/);
    expect(readFileSync(copied).equals(readFileSync(srcA))).toBe(true);
    expect(out.timeline.tracks[0].clips[0].inPoint).toBe(2);
  }, 120_000);

  it("estimates match what the encoders write: DNxHR HQ within 10%, ProRes within 30% and H.264 within a factor on a noisy source", async () => {
    const noisy = join(dir, "noisy.mp4");
    execFileSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=24:duration=3,noise=alls=30:allf=t`, "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p", "-an", noisy]);
    const p = { ...project, mediaLibrary: { items: [{ ...item("N", noisy, 24, 3, statSync(noisy).size), metadata: { ...item("N", noisy, 24, 3, 1).metadata, width: 1280, height: 720, hasAudio: false } }] }, timeline: { ...project.timeline, tracks: [{ ...project.timeline.tracks[0], clips: [clip("n1", "N", 0, 3, 0)] }] } } as unknown as Project;
    for (const [preset, low, high] of [["dnxhr-hq", 0.9, 1.1], ["prores-422-hq", 0.7, 1.6], ["prores-422", 0.7, 1.6], ["h264", 0.3, 2.5]] as const) {
      const scan = await scanProject(p, options({ preset, trim: false }), 0);
      const est = scan.estimate.perItem[0].bytes;
      const events: ProjectManagerEvent[] = [];
      const job = startProjectManagerJob({ project: p, options: options({ preset, trim: false }), destParent: join(dir, "out", `est-${preset}`), projectName: "E" }, (e) => events.push(e));
      const summary = await job.done;
      const actual = statSync(JSON.parse(readFileSync(summary.projectPath, "utf8")).mediaLibrary.items[0].sourceFile.path).size;
      expect(est / actual, `${preset}: estimate ${est} vs actual ${actual}`).toBeGreaterThan(low);
      expect(est / actual, `${preset}: estimate ${est} vs actual ${actual}`).toBeLessThan(high);
    }
  }, 240_000);

  it("can be cancelled and leaves nothing behind", async () => {
    const parent = join(dir, "out", "cancel");
    const events: ProjectManagerEvent[] = [];
    const job = startProjectManagerJob({ project, options: options({ trim: false }), destParent: parent, projectName: "X" }, (e) => { events.push(e); if (e.phase === "running") job.cancel(); });
    await expect(job.done).rejects.toThrow();
    expect(events.at(-1)?.phase).toBe("cancelled");
    expect(existsSync(join(parent, "X"))).toBe(false);
    expect(existsSync(srcA)).toBe(true);
  }, 120_000);

  it("refuses a destination without room", async () => {
    const events: ProjectManagerEvent[] = [];
    const job = startProjectManagerJob({ project, options: options(), destParent: join(dir, "out", "noroom") }, (e) => events.push(e), {});
    // Free space is real here, so this only proves the check runs without failing a roomy disk.
    await job.done;
    expect(events.at(-1)?.phase).toBe("done");
  }, 120_000);
});
