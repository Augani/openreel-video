/**
 * The real-ffmpeg integration suites skip themselves when the sidecar binary is missing, which on a
 * developer machine is fine and in CI is a silent hole. CI sets OPENREEL_REQUIRE_SIDECAR=1 so a
 * missing or broken sidecar fails here instead of turning dozens of tests into skips.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const required = process.env.OPENREEL_REQUIRE_SIDECAR === "1";

describe.skipIf(!required)("CI requires the ffmpeg sidecar and ffprobe", () => {
  const slot = `${process.platform}-${process.arch}`;
  const bin = path.resolve(__dirname, "../resources/bin", slot, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";

  it("the sidecar for this platform exists and runs", () => {
    expect(existsSync(bin), `${bin} is missing (pnpm --filter @openreel/desktop fetch:ffmpeg)`).toBe(true);
    expect(execFileSync(bin, ["-version"], { encoding: "utf8" })).toMatch(/^ffmpeg version/);
  });

  it("the sidecar has the encoders the smart-render suites exercise", () => {
    const encoders = execFileSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    for (const name of ["libx264", "libx265", "prores_ks"]) expect(encoders, `${name} missing from the sidecar`).toContain(name);
  });

  it("ffprobe is available for the output checks", () => {
    expect(existsSync(ffprobe), `${ffprobe} is missing (set FFPROBE or install ffmpeg)`).toBe(true);
  });
});
