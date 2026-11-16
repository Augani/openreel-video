/**
 * ffprobe / ffmpeg assertions shared by export-check.mjs and the smart-export
 * integration test: is a file frame-accurate, seek-decodable and pixel-close.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const big = { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 };

/** Every video packet of a file in decode order: {pts, dts, key} in seconds. */
export function probeVideoPackets(ffprobe, file) {
  const out = execFileSync(
    ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,dts_time,flags", "-of", "csv=p=0", file],
    big,
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pts, dts, flags] = line.split(",");
      return { pts: Number(pts), dts: Number(dts), key: (flags ?? "").includes("K") };
    });
}

/**
 * Frame-accuracy checks on a video's packets: exactly `frames` frames, the
 * first one presented at 0, no missing or duplicated frame (consecutive
 * presentation times are exactly one frame apart), strictly increasing decode
 * times, and key frames where `expectedKeyframes` says they must be.
 */
export function checkTimeline(packets, { frames, fps, expectedKeyframes = [], tolerance = 2e-4 }) {
  const problems = [];
  const frameDuration = 1 / fps;
  if (packets.length !== frames) problems.push(`expected ${frames} frames, found ${packets.length}`);
  const pts = packets.map((p) => p.pts).sort((a, b) => a - b);
  if (pts.length && Math.abs(pts[0]) > tolerance) problems.push(`first frame presented at ${pts[0]}s, not 0`);
  let gaps = 0;
  let dups = 0;
  let worst = 0;
  for (let i = 1; i < pts.length; i++) {
    const step = pts[i] - pts[i - 1];
    worst = Math.max(worst, Math.abs(step - frameDuration));
    if (step < frameDuration * 0.5) dups++;
    else if (Math.abs(step - frameDuration) > tolerance) gaps++;
  }
  if (dups) problems.push(`${dups} duplicated frame time(s)`);
  if (gaps) problems.push(`${gaps} gap(s) or irregular frame interval(s) (worst ${worst.toExponential(2)}s)`);
  let dtsOk = true;
  for (let i = 1; i < packets.length; i++) if (!(packets[i].dts > packets[i - 1].dts)) dtsOk = false;
  if (!dtsOk) problems.push("decode timestamps are not strictly increasing");
  // Key frames by presentation index.
  const byPts = [...packets].sort((a, b) => a.pts - b.pts);
  const keyIndexes = byPts.map((p, i) => (p.key ? i : -1)).filter((i) => i >= 0);
  for (const index of expectedKeyframes) {
    if (!keyIndexes.includes(index)) problems.push(`frame ${index} is not a key frame`);
  }
  return { ok: problems.length === 0, problems, frames: packets.length, keyIndexes, worstIntervalError: worst };
}

/** Decode a whole file with ffmpeg; returns the error output ("" when clean). */
export function decodeErrors(ffmpeg, file) {
  try {
    return execFileSync(ffmpeg, ["-v", "error", "-i", file, "-f", "null", "-"], { ...big, stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return String(error.stderr ?? error).trim();
  }
}

/** Seek into the middle of the file and decode a few frames: a broken index or missing key frame shows up here. */
export function seekDecodes(ffmpeg, file, times) {
  const failures = [];
  for (const t of times) {
    try {
      const out = execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "5", "-f", "null", "-"], {
        ...big,
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (out) failures.push(`seek ${t}s: ${out.split("\n")[0]}`);
    } catch (error) {
      failures.push(`seek ${t}s: ${String(error.stderr ?? error).split("\n")[0]}`);
    }
  }
  return failures;
}

/** Raw yuv420p bytes of the frames at `indexes` (decode/presentation order), one Buffer per index. */
function rawFrames(ffmpeg, file, width, height, indexes) {
  const expr = indexes.map((i) => `eq(n\\,${i})`).join("+");
  const raw = execFileSync(
    ffmpeg,
    ["-v", "error", "-i", file, "-an", "-vf", `select='${expr}'`, "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 30 },
  );
  const size = (width * height * 3) / 2;
  const frames = [];
  for (let off = 0; off + size <= raw.length; off += size) frames.push(raw.subarray(off, off + size));
  return frames;
}

function psnrOf(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  const mse = sum / a.length;
  return { mse, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
}

/**
 * PSNR (all yuv420p planes, straight from the decoders, so a colour tag that
 * differs between files cannot change pixels) of frame i of `a` against frame
 * i of `b` for every i in `indexes`. Returns [{index, psnr, mse}].
 */
export function framePsnr(ffmpeg, a, b, { width, height, indexes }) {
  const out = [];
  const batch = 90;
  for (let from = 0; from < indexes.length; from += batch) {
    const chunk = indexes.slice(from, from + batch);
    const fa = rawFrames(ffmpeg, a, width, height, chunk);
    const fb = rawFrames(ffmpeg, b, width, height, chunk);
    if (fa.length !== chunk.length || fb.length !== chunk.length) {
      throw new Error(`decoded ${fa.length}/${fb.length} of ${chunk.length} requested frames`);
    }
    chunk.forEach((index, i) => out.push({ index, ...psnrOf(fa[i], fb[i]) }));
  }
  return out;
}

/** Summarise a PSNR series over frame indexes [from, to): min and mean in dB, infinity counted as 99. */
export function summarizePsnr(series, from, to) {
  const slice = series.filter((f) => f.index >= from && f.index < to).map((f) => (Number.isFinite(f.psnr) ? f.psnr : 99));
  if (!slice.length) return { min: null, mean: null, frames: 0 };
  return { min: Math.min(...slice), mean: slice.reduce((x, y) => x + y, 0) / slice.length, frames: slice.length };
}

/** Frame indexes 0..frames-1 when frames <= maxCount, otherwise an even sample that always includes the edges listed in `must`. */
export function sampleIndexes(frames, maxCount, must = []) {
  if (frames <= maxCount) return Array.from({ length: frames }, (_, i) => i);
  const set = new Set(must.filter((i) => i >= 0 && i < frames));
  const step = Math.max(1, Math.floor(frames / (maxCount - set.size)));
  for (let i = 0; i < frames; i += step) set.add(i);
  return [...set].sort((x, y) => x - y);
}
