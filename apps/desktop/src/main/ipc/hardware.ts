import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HardwareInfo } from "../../shared/ipc-contract";
import { probeEncoders } from "../sidecar/encoder-probe";

const run = promisify(execFile);

async function probeGpus(): Promise<string[]> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await run("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 4000 });
      const json = JSON.parse(stdout) as { SPDisplaysDataType?: { sppci_model?: string }[] };
      return (json.SPDisplaysDataType ?? []).map((g) => g.sppci_model ?? "GPU").filter(Boolean);
    }
    if (process.platform === "win32") {
      const { stdout } = await run("wmic", ["path", "win32_VideoController", "get", "name"], { timeout: 4000 });
      return stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "Name");
    }
    const { stdout } = await run("sh", ["-c", "lspci | grep -iE 'vga|3d|display' || true"], { timeout: 4000 });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function collectHardwareInfo(): Promise<HardwareInfo> {
  const cpus = os.cpus();
  return {
    cpu: {
      model: cpus[0]?.model?.trim() ?? "unknown",
      physicalCores: cpus.length,
      logicalCores: cpus.length,
    },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    gpus: await probeGpus(),
    encoders: await probeEncoders(),
    platform: process.platform as HardwareInfo["platform"],
    arch: process.arch,
  };
}
