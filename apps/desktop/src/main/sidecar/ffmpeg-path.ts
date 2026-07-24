import path from "node:path";
import { app } from "electron";

export function ffmpegRelativePath(platform: NodeJS.Platform, arch: string): string {
  const dir = `${platform}-${arch}`;
  const bin = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return `${dir}/${bin}`;
}

export function resolveFfmpegPath(): string {
  const rel = ffmpegRelativePath(process.platform, process.arch);
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "../../resources/bin");
  return path.join(base, rel);
}
