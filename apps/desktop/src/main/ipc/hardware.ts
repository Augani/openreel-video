import os from "node:os";
import { app } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HardwareInfo } from "../../shared/ipc-contract";
import { probeEncoders } from "../sidecar/encoder-probe";

const run = promisify(execFile);

interface GpuInfoLike {
  gpuDevice?: { vendorId?: number; deviceId?: number; active?: boolean }[];
  auxAttributes?: { glRenderer?: string };
}

const VENDORS: Record<number, string> = {
  0x10de: "NVIDIA",
  0x1002: "AMD",
  0x8086: "Intel",
  0x106b: "Apple",
};

const VENDOR_ONLY = /^(NVIDIA|AMD|Intel|Apple|vendor 0x[0-9a-f]+) GPU$/i;

/** True for the placeholder strings parseGpuInfo emits when no renderer name is known. */
export function isVendorOnly(name: string): boolean {
  return VENDOR_ONLY.test(name.trim());
}

/**
 * Reduce an ANGLE wrapper to the bare device name, e.g.
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" -> "Apple M2 Pro".
 * Strings without the wrapper are returned trimmed.
 */
export function cleanRendererName(raw: string): string {
  const text = raw.trim();
  const m = /^ANGLE\s*\((.*)\)$/s.exec(text);
  if (!m) return text;
  const parts = m[1].split(",").map((p) => p.trim());
  let name = parts.length >= 2 ? parts[1] : parts[0];
  name = name
    .replace(/^ANGLE\s+.*?Renderer:\s*/i, "")
    .replace(/\s+Direct3D\w*(\s+vs_\S+)?(\s+ps_\S+)?\s*$/i, "")
    .replace(/\s*\(0x[0-9a-f]+\)\s*$/i, "")
    .trim();
  return name || text;
}

export function parseGpuInfo(info: GpuInfoLike): string[] {
  const renderer = info.auxAttributes?.glRenderer?.trim();
  if (renderer) return [cleanRendererName(renderer)];
  return (info.gpuDevice ?? []).map((d) => {
    const vendor = VENDORS[d.vendorId ?? -1] ?? `vendor 0x${(d.vendorId ?? 0).toString(16)}`;
    return `${vendor} GPU`;
  });
}

interface GpuProbeDeps {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  getInfo: (type: "basic" | "complete") => Promise<GpuInfoLike>;
  systemQuery: () => Promise<string[]>;
}

const COMPLETE_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const usable = (names: string[]): boolean => names.length > 0 && names.every((n) => !isVendorOnly(n));

/**
 * GPU names that getGpuTier can score. The "basic" info often has no renderer on
 * macOS and yields only a vendor placeholder, so escalate: Apple Silicon CPU model
 * (the SoC name is the GPU family), then "complete" info, then OS tools.
 */
export async function resolveGpuNames(deps: GpuProbeDeps): Promise<string[]> {
  if (deps.platform === "darwin" && deps.arch === "arm64" && /^Apple M\d/i.test(deps.cpuModel.trim())) {
    return [deps.cpuModel.trim()];
  }
  let best: string[] = [];
  try {
    best = parseGpuInfo(await deps.getInfo("basic"));
    if (usable(best)) return best;
  } catch {
    // fall through to the next source
  }
  try {
    const full = parseGpuInfo(await withTimeout(deps.getInfo("complete"), COMPLETE_TIMEOUT_MS));
    if (usable(full)) return full;
    if (best.length === 0) best = full;
  } catch {
    // fall through to the next source
  }
  try {
    const sys = (await deps.systemQuery()).map(cleanRendererName);
    if (usable(sys)) return sys;
  } catch {
    // keep what we have
  }
  return best;
}

async function systemGpuQuery(): Promise<string[]> {
  if (process.platform === "darwin") {
    const { stdout } = await run("system_profiler", ["SPDisplaysDataType", "-json"], { timeout: 4000 });
    const json = JSON.parse(stdout) as { SPDisplaysDataType?: { sppci_model?: string }[] };
    return (json.SPDisplaysDataType ?? []).map((g) => g.sppci_model ?? "").filter(Boolean);
  }
  if (process.platform === "win32") {
    const { stdout } = await run("wmic", ["path", "win32_VideoController", "get", "name"], { timeout: 4000 });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "Name");
  }
  const { stdout } = await run("sh", ["-c", "lspci | grep -iE 'vga|3d|display' || true"], { timeout: 4000 });
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function probeGpus(): Promise<string[]> {
  try {
    return await resolveGpuNames({
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? "",
      getInfo: (type) => app.getGPUInfo(type) as Promise<GpuInfoLike>,
      systemQuery: systemGpuQuery,
    });
  } catch {
    return [];
  }
}

let physicalCores: Promise<number> | null = null;

function getPhysicalCores(logical: number): Promise<number> {
  if (process.platform !== "darwin") return Promise.resolve(logical);
  physicalCores ??= run("sysctl", ["-n", "hw.physicalcpu"], { timeout: 2000 })
    .then(({ stdout }) => {
      const n = parseInt(stdout.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : logical;
    })
    .catch(() => logical);
  return physicalCores;
}

export async function collectHardwareInfo(): Promise<HardwareInfo> {
  const cpus = os.cpus();
  const logical = os.availableParallelism();
  return {
    cpu: {
      model: cpus[0]?.model?.trim() ?? "unknown",
      physicalCores: await getPhysicalCores(logical),
      logicalCores: logical,
    },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    gpus: await probeGpus(),
    encoders: await probeEncoders(),
    platform: process.platform as HardwareInfo["platform"],
    arch: process.arch,
  };
}
