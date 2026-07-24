import { access } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { RiggingBackendMode } from "../../shared/ipc-contract";

export interface BlenderCandidate {
  readonly path: string;
  readonly mode: RiggingBackendMode;
}

export function blenderRelativePath(platform: NodeJS.Platform, arch: string): string {
  const slot = `${platform}-${arch}`;
  if (platform === "darwin") {
    return `blender/${slot}/Blender.app/Contents/MacOS/Blender`;
  }
  return `blender/${slot}/${platform === "win32" ? "blender.exe" : "blender"}`;
}

export function riggingResourceRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "rigging")
    : path.join(__dirname, "../../resources/rigging");
}

export function bundledBlenderPath(): string {
  return path.join(riggingResourceRoot(), blenderRelativePath(process.platform, process.arch));
}

export function blenderCandidates(env: NodeJS.ProcessEnv = process.env): BlenderCandidate[] {
  const configured = env.OPENREEL_BLENDER_PATH || env.BLENDER_PATH;
  const candidates: BlenderCandidate[] = [];
  if (configured) candidates.push({ path: configured, mode: "configured" });
  candidates.push({ path: bundledBlenderPath(), mode: "bundled" });

  if (process.platform === "darwin") {
    candidates.push(
      { path: "/Applications/Blender.app/Contents/MacOS/Blender", mode: "system" },
      { path: "/opt/homebrew/bin/blender", mode: "system" },
      { path: "/usr/local/bin/blender", mode: "system" },
    );
  } else if (process.platform === "win32") {
    candidates.push(
      { path: "C:\\Program Files\\Blender Foundation\\Blender\\blender.exe", mode: "system" },
      { path: "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe", mode: "system" },
      { path: "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe", mode: "system" },
    );
  } else {
    candidates.push(
      { path: "/usr/bin/blender", mode: "system" },
      { path: "/usr/local/bin/blender", mode: "system" },
      { path: "blender", mode: "system" },
    );
  }
  return candidates;
}

export async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
