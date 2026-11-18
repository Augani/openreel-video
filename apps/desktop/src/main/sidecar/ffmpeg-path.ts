import path from "node:path";
import { app } from "electron";

export function ffmpegRelativePath(platform: NodeJS.Platform, arch: string): string {
  const dir = `${platform}-${arch}`;
  const bin = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return `${dir}/${bin}`;
}

export function resolveFfmpegPath(): string {
  // Development and test override (never honoured in a packaged build): run against another ffmpeg.
  const override = process.env.OPENREEL_FFMPEG_PATH;
  if (override && !app.isPackaged) return override;
  const rel = ffmpegRelativePath(process.platform, process.arch);
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "../../resources/bin");
  return path.join(base, rel);
}
