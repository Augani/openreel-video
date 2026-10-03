import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// This harness generates fixtures and checks the real file delivered by the UI.
// It deliberately does not drive a browser or add a test endpoint to the app.
const cases = {
  "landscape-mp4": { fixture: "landscape-av.mp4", width: 640, height: 360, fps: 24, duration: 2, codec: "h264", audio: true },
  "landscape-webm": { fixture: "landscape-av.mp4", width: 640, height: 360, fps: 24, duration: 2, codec: "vp9", audio: true },
  "portrait-60": { fixture: "portrait-av.mp4", width: 360, height: 640, fps: 60, duration: 2, codec: "h264", audio: true },
  "silent-webm": { fixture: "silent.webm", width: 640, height: 360, fps: 30, duration: 2, codec: "vp9", audio: false },
  "trimmed-mixed": { fixture: "landscape-av.mp4 + portrait-av.mp4", width: 640, height: 360, fps: 24, duration: 3, codec: "h264", audio: true },
  "proxy-originals": { fixture: "/tmp/openreel-next-proxy-source.mp4", width: 1920, height: 1080, fps: 24, duration: 2, codec: "h264", audio: true },
};
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
};
const [mode, arg, file] = process.argv.slice(2);
if (mode === "fixtures") {
  const directory = resolve(arg ?? ".codex-audit/browser-export/fixtures");
  mkdirSync(directory, { recursive: true });
  for (const [name, size, fps] of [["landscape-av.mp4", "640x360", 24], ["portrait-av.mp4", "360x640", 60]]) {
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=${fps}:duration=2`, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-movflags", "+faststart", "-shortest", join(directory, name)]);
  }
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2", "-c:v", "libvpx-vp9", "-an", join(directory, "silent.webm")]);
  writeFileSync(join(directory, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
  console.log(JSON.stringify({ fixtures: directory, cases }, null, 2));
} else if (mode === "verify") {
  const expected = cases[arg];
  if (!expected || !file) throw new Error("Usage: verify <case-id> <absolute-path-to-downloaded-export>");
  const path = resolve(file);
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path]));
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const ratio = (value) => { const [a, b = 1] = String(value).split("/").map(Number); return a / b; };
  const failures = [];
  if (!video) failures.push("Video stream is missing");
  else {
    if (video.codec_name !== expected.codec) failures.push(`Codec ${video.codec_name}, expected ${expected.codec}`);
    if (video.width !== expected.width || video.height !== expected.height) failures.push(`Size ${video.width}x${video.height}, expected ${expected.width}x${expected.height}`);
    if (Math.abs(ratio(video.avg_frame_rate) - expected.fps) > 0.05) failures.push(`Frame rate ${video.avg_frame_rate}, expected ${expected.fps}`);
  }
  if (Math.abs(Number(probe.format.duration) - expected.duration) > 0.15) failures.push(`Duration ${probe.format.duration}, expected ${expected.duration}`);
  if (expected.audio && !audio) failures.push("Expected audio stream is missing");
  // Decode the entire output, not only the container header.
  run("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"]);
  const report = { case: arg, path, checkedAt: new Date().toISOString(), bytes: statSync(path).size, passed: failures.length === 0, failures, expected, actual: { duration: probe.format.duration, video, audio } };
  writeFileSync(`${path}.validation.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} else {
  console.log("Usage: node apps/web/scripts/validate-browser-export.mjs fixtures [directory]\n       node apps/web/scripts/validate-browser-export.mjs verify <case-id> <downloaded-file>");
}
