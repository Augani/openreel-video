#!/usr/bin/env node
/**
 * Long-form soak material, generated with ffmpeg (no network, deterministic).
 *
 *   node apps/web/e2e/soak/gen-media.mjs [outDir]
 *
 * A 30 s "seed" with real motion + speech-like audio is encoded once per codec profile and then
 * stream-copied in a loop to the target duration (-stream_loop, no re-encode), so a 10-20 min
 * long-GOP source costs seconds instead of an hour of x264 time while keeping the real GOP structure,
 * keyframe cadence and container (moov/index) size of a long file.
 *
 * Env: SOAK_MEDIA_DIR (default <os tmp>/openreel-soak-media), SOAK_MEDIA_SCALE (default 1; 0.1 makes
 * every source 10x shorter, for a smoke run), SOAK_MEDIA_ONLY=comma,list of source names.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG = process.env.OPENREEL_FFMPEG ?? process.env.FFMPEG ?? "ffmpeg";
export const MEDIA_DIR = process.argv[2] ?? process.env.SOAK_MEDIA_DIR ?? join(tmpdir(), "openreel-soak-media");
const SCALE = Number(process.env.SOAK_MEDIA_SCALE ?? 1);
const ONLY = process.env.SOAK_MEDIA_ONLY?.split(",").filter(Boolean);

/** Speech-like audio: syllable-rate amplitude-modulated pink noise over a tone, band-limited. */
const AUDIO_SRC = (seconds) => [
  "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.35:sample_rate=48000:duration=${seconds}`,
  "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=${seconds}`,
];
const AUDIO_FILTER =
  "[2:a]volume=0.12[t];[1:a]tremolo=f=4.5:d=0.85,highpass=f=120,lowpass=f=4200[s];[s][t]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[a]";

/** Durations are minutes of final length. */
export const SOURCES = [
  { name: "hd-h264-longgop", w: 1920, h: 1080, fps: 30, minutes: 12, codec: "h264", gop: 250, kbps: 4000, note: "1080p H.264 long-GOP (8 s keyframes)" },
  { name: "hd-h264-varkf", w: 1920, h: 1080, fps: 25, minutes: 10, codec: "h264", gop: 600, forceKf: "expr:gte(t,n_forced*7.3)", kbps: 3500, note: "1080p H.264, irregular forced keyframes (~7.3 s) + scenecut" },
  { name: "uhd-h264-longgop", w: 3840, h: 2160, fps: 30, minutes: 10, codec: "h264", gop: 300, kbps: 9000, note: "4K H.264 long-GOP (10 s keyframes)" },
  { name: "uhd-hevc", w: 3840, h: 2160, fps: 24, minutes: 10, codec: "hevc", gop: 240, kbps: 6000, note: "4K HEVC" },
  { name: "hd-hevc-vfr", w: 1920, h: 1080, fps: 30, minutes: 10, codec: "hevc", gop: 150, kbps: 3000, vfr: true, note: "1080p HEVC, variable frame rate (phone-like)" },
  { name: "odd-h264", w: 1278, h: 718, fps: 30, minutes: 10, codec: "h264", gop: 120, kbps: 2500, note: "1278x718 (not a multiple of 16/4) H.264" },
  { name: "hd-prores-422proxy", w: 1920, h: 1080, fps: 30, minutes: 3, codec: "prores", kbps: 0, note: "1080p ProRes 422 Proxy (desktop only)", desktopOnly: true },
];

function run(args) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

function seedFor(p, seedPath) {
  const seedSec = 30;
  // Real motion + sensor-like noise so the encoder does not collapse to near-zero bitrate.
  let chain = "noise=alls=14:allf=t,format=yuv420p";
  // VFR: drop a pseudo-random ~35% of frames and keep their original timestamps (-fps_mode vfr).
  if (p.vfr) chain = "noise=alls=14:allf=t,select='gt(random(0)\\,0.35)',format=yuv420p";
  const video = {
    h264: ["-c:v", "libx264", "-preset", "veryfast", "-b:v", `${p.kbps}k`, "-maxrate", `${Math.round(p.kbps * 1.6)}k`, "-bufsize", `${p.kbps * 2}k`, "-g", String(p.gop), "-keyint_min", "24", "-profile:v", "high", "-pix_fmt", "yuv420p", ...(p.forceKf ? ["-force_key_frames", p.forceKf] : [])],
    hevc: ["-c:v", "libx265", "-preset", "veryfast", "-b:v", `${p.kbps}k`, "-x265-params", `keyint=${p.gop}:min-keyint=24:log-level=error`, "-tag:v", "hvc1", "-pix_fmt", "yuv420p"],
    prores: ["-c:v", "prores_ks", "-profile:v", "0", "-pix_fmt", "yuv422p10le"],
  }[p.codec];
  const audio = p.codec === "prores" ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "128k"];
  run([
    "-f", "lavfi", "-i", `testsrc2=size=${p.w}x${p.h}:rate=${p.fps}:duration=${seedSec}`,
    ...AUDIO_SRC(seedSec),
    "-filter_complex", `[0:v]${chain}[v];${AUDIO_FILTER}`,
    "-map", "[v]", "-map", "[a]",
    ...video, ...audio,
    ...(p.vfr ? ["-fps_mode", "vfr"] : []),
    "-t", String(seedSec),
    ...(p.codec === "prores" ? [] : ["-movflags", "+faststart"]),
    seedPath,
  ]);
}

export function generate() {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const manifest = [];
  for (const p of SOURCES) {
    if (ONLY && !ONLY.includes(p.name)) continue;
    const ext = p.codec === "prores" ? "mov" : "mp4";
    const out = join(MEDIA_DIR, `${p.name}.${ext}`);
    const seed = join(MEDIA_DIR, `.seed-${p.name}.${ext}`);
    const seconds = Math.round(p.minutes * 60 * SCALE);
    if (!existsSync(out)) {
      const t0 = Date.now();
      if (!existsSync(seed)) seedFor(p, seed);
      // Loop the encoded seed without re-encoding: keyframe cadence and GOP structure are preserved.
      run(["-stream_loop", "-1", "-i", seed, "-c", "copy", "-t", String(seconds), ...(p.codec === "prores" ? [] : ["-movflags", "+faststart"]), out]);
      console.log(`[gen-media] ${p.name}: ${seconds}s, ${(statSync(out).size / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    manifest.push({ ...p, file: out, seconds, bytes: statSync(out).size });
  }
  writeFileSync(join(MEDIA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) generate();
