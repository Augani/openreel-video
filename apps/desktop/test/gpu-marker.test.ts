import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";

const h = vi.hoisted(() => ({ dir: "", disable: vi.fn() }));

vi.mock("electron", () => ({
  app: {
    getPath: () => h.dir,
    disableHardwareAcceleration: h.disable,
    commandLine: { appendSwitch: vi.fn() },
    on: vi.fn(),
  },
}));

import { applyPerformanceSwitches, consumeGpuFallbackLaunch } from "../src/main/gpu/switches";

const marker = (): string => path.join(h.dir, ".openreel-gpu-disabled");

beforeEach(() => {
  h.dir = mkdtempSync(path.join(os.tmpdir(), "openreel-gpumarker-"));
  h.disable.mockClear();
});
afterEach(() => rmSync(h.dir, { recursive: true, force: true }));

describe("GPU fallback marker", () => {
  it("applyPerformanceSwitches disables acceleration but leaves the counter alone", () => {
    writeFileSync(marker(), "3");
    applyPerformanceSwitches();
    expect(h.disable).toHaveBeenCalled();
    expect(readFileSync(marker(), "utf8")).toBe("3");
  });

  it("consumeGpuFallbackLaunch counts down and removes the marker at the end", () => {
    writeFileSync(marker(), "2");
    consumeGpuFallbackLaunch();
    expect(readFileSync(marker(), "utf8")).toBe("1");
    consumeGpuFallbackLaunch();
    expect(existsSync(marker())).toBe(false);
    consumeGpuFallbackLaunch();
    expect(existsSync(marker())).toBe(false);
  });
});
