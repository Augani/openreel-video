#!/usr/bin/env node
/**
 * Generates the original practice clips shipped with the Learn path (resources/samples).
 * Everything is synthesised with ffmpeg lavfi sources, so there is no third-party footage and nothing
 * is downloaded. The output is committed; re-run only to change the pack:
 *
 *   node apps/desktop/scripts/generate-samples.mjs     (uses ffmpeg/ffprobe from PATH, or $FFMPEG / $FFPROBE)
 *
 * Real footage can replace the pack: drop files in resources/samples, list them in manifest.json
 * (id, name, kind, file, mimeType, license, durationSec, sizeBytes) and the samples IPC serves them as-is.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../resources/samples");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg$/, "ffprobe");
const LICENSE = "CC0-1.0 (original, generated with ffmpeg lavfi sources)";
const W = 1280;
const H = 720;
const FPS = 25;
const VIDEO_ARGS = [
  "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p",
  "-r", String(FPS), "-movflags", "+faststart", "-an",
];

const clips = [
  {
    id: "practice-aurora",
    name: "Aurora drift",
    file: "practice-aurora.mp4",
    source: `gradients=s=${W}x${H}:d=6:r=${FPS}:speed=0.04:n=4:c0=0x1d4ed8:c1=0x7c3aed:c2=0x06b6d4:c3=0x0f172a`,
    vf: "format=yuv420p",
  },
  {
    id: "practice-fractal",
    name: "Fractal zoom",
    file: "practice-fractal.mp4",
    source: `mandelbrot=s=${W}x${H}:r=${FPS}:end_scale=0.001:inner=convergence`,
    vf: "hue=h=210:s=1.4,format=yuv420p",
  },
  {
    id: "practice-cells",
    name: "Living cells",
    file: "practice-cells.mp4",
    source: `life=s=320x180:r=${FPS}:ratio=0.12:mold=12:life_color=0xfbbf24:death_color=0x7c2d12:random_seed=7`,
    vf: `scale=${W}:${H}:flags=neighbor,format=yuv420p`,
  },
];

function run(bin, args) {
  return execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

fs.mkdirSync(out, { recursive: true });
const manifest = [];

for (const clip of clips) {
  const dest = path.join(out, clip.file);
  run(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", clip.source,
    "-t", "6", "-vf", clip.vf, ...VIDEO_ARGS, dest,
  ]);
  manifest.push({
    id: clip.id, name: clip.name, kind: "video", file: clip.file,
    mimeType: "video/mp4", width: W, height: H, license: LICENSE,
  });
}

// "Practice beat": a soft chord pad over a slow pulse, 20 s, original.
const dur = 20;
const pad = (f, v) => `sine=f=${f}:d=${dur}:r=44100,volume=${v},tremolo=f=0.4:d=0.35`;
run(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", pad(220, 0.5),
  "-f", "lavfi", "-i", pad(277.18, 0.4),
  "-f", "lavfi", "-i", pad(329.63, 0.4),
  "-f", "lavfi", "-i", `sine=f=55:d=${dur}:r=44100,volume=1.2,tremolo=f=2:d=1`,
  "-filter_complex",
  `amix=inputs=4:normalize=0,lowpass=f=2400,afade=t=in:d=1,afade=t=out:st=${dur - 2}:d=2,aformat=channel_layouts=stereo`,
  "-t", String(dur), "-c:a", "libmp3lame", "-b:a", "96k", path.join(out, "practice-music.mp3"),
]);
manifest.push({
  id: "practice-music", name: "Practice beat", kind: "audio", file: "practice-music.mp3",
  mimeType: "audio/mpeg", license: LICENSE,
});

for (const entry of manifest) {
  const file = path.join(out, entry.file);
  entry.sizeBytes = fs.statSync(file).size;
  const seconds = Number(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
  entry.durationSec = Math.round(seconds * 100) / 100;
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version: 1, clips: manifest }, null, 2) + "\n");
const total = manifest.reduce((sum, e) => sum + e.sizeBytes, 0);
console.log(`wrote ${manifest.length} files, ${(total / 1024 / 1024).toFixed(2)} MB total -> ${out}`);
