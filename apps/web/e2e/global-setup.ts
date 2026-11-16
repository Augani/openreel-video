import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { E2E_CHANNEL } from "./env";
import { preflightBrowser } from "./browser-preflight";

export const FIXTURE_DIR = join(tmpdir(), "openreel-e2e-fixtures-v3");
export const FIXTURE_PATH = join(FIXTURE_DIR, "three-scenes.mp4");
export const AUDIO_FIXTURE_PATH = join(FIXTURE_DIR, "tone-4s.wav");

/** 3 x 2s scenes (testsrc2, solid red, smptebars), 640x360 @ 30fps + sine audio. */
export default async function globalSetup(): Promise<void> {
  await preflightBrowser(E2E_CHANNEL, () => chromium.launch({ channel: E2E_CHANNEL, headless: true, timeout: 45_000 }));
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "ffmpeg was not found on PATH. The Premiere-parity e2e suite generates its fixture video with ffmpeg; install it (e.g. `brew install ffmpeg`) and re-run `pnpm test:e2e`.",
    );
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  if (!existsSync(AUDIO_FIXTURE_PATH))
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=4", AUDIO_FIXTURE_PATH],
      { stdio: "ignore" },
    );
  if (existsSync(FIXTURE_PATH)) return;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
      "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=30:duration=2",
      "-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
      "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-g", "15", "-pix_fmt", "yuv420p",
      // Fully tag the colour space (matrix, primaries, transfer, range) in the H.264 VUI and
      // the mp4 colr box. Chrome's software (no GPU) <video> pipeline reads an untagged or
      // partly tagged stream as BT.601, while WebCodecs reads it as BT.709, so the paused
      // preview and the compositor/export would disagree on nearly every pixel (red 231 vs
      // 253). Real camera files are fully tagged; the fixture must be too.
      "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv",
      "-movflags", "+write_colr",
      "-c:a", "aac", "-shortest",
      FIXTURE_PATH,
    ],
    { stdio: "ignore" },
  );
}
