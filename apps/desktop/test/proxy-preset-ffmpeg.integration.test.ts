import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProxyArgs } from "../src/main/ingest/proxy-args";
import { PROXY_PRESETS } from "../../../packages/core/src/media/proxy-presets";

const have = spawnSync("ffmpeg", ["-version"]).status === 0;

// Runs every proxy preset through a real ffmpeg and checks the file it writes with ffprobe.
describe.skipIf(!have)("proxy presets produce real files with ffmpeg", () => {
  // describe.skipIf still runs this callback to collect tests, so the ffmpeg work must wait for beforeAll.
  const dir = mkdtempSync(join(tmpdir(), "openreel-proxy-preset-"));
  const src = join(dir, "src.mp4");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeAll(() => execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", src]));
  const probe = (file: string) =>
    JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", file]).toString()).streams[0] as { codec_name: string; width: number; height: number };

  for (const preset of PROXY_PRESETS) {
    it(`${preset.id}`, () => {
      const ext = preset.profile.codec === "h264" ? "mp4" : "mov";
      const out = join(dir, `${preset.id}.${ext}`);
      const args = buildProxyArgs({ srcPath: src, outPath: out, srcWidth: 1280, srcHeight: 720, threads: 2, profile: preset.profile });
      const run = spawnSync("ffmpeg", ["-y", ...args], { encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      expect(existsSync(out)).toBe(true);
      const v = probe(out);
      const expected = { "prores-proxy": "prores", "h264-half": "h264", "h264-quarter": "h264", "dnxhr-lb": "dnxhd" }[preset.id];
      if (expected) expect(v.codec_name).toBe(expected);
      expect(v.width).toBeLessThanOrEqual(1280);
    });
  }
});
