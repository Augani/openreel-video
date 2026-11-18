import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { getGPUInfo: vi.fn() } }));

import { parseGpuInfo, cleanRendererName, resolveGpuNames, isVendorOnly } from "../src/main/ipc/hardware";

describe("parseGpuInfo", () => {
  it("prefers the GL renderer string", () => {
    expect(parseGpuInfo({ auxAttributes: { glRenderer: " ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version) " }, gpuDevice: [{ vendorId: 0x106b }] })).toEqual([
      "Apple M2 Pro",
    ]);
  });
});

describe("cleanRendererName", () => {
  it("strips ANGLE wrappers", () => {
    expect(cleanRendererName("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)")).toBe("Apple M2 Pro");
    expect(cleanRendererName("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe("NVIDIA GeForce RTX 3080");
  });
});

describe("resolveGpuNames", () => {
  const base = {
    platform: "darwin" as const,
    arch: "arm64",
    cpuModel: "Apple M2 Pro",
    getInfo: vi.fn(async () => ({ gpuDevice: [{ vendorId: 0x106b }] })),
    systemQuery: vi.fn(async () => ["Apple M2 Pro"]),
  };

  it("uses the Apple Silicon CPU model without probing", async () => {
    const getInfo = vi.fn();
    expect(await resolveGpuNames({ ...base, getInfo })).toEqual(["Apple M2 Pro"]);
    expect(getInfo).not.toHaveBeenCalled();
  });

  it("escalates past a vendor-only basic result to complete info", async () => {
    const getInfo = vi.fn(async (type: string) =>
      type === "basic"
        ? { gpuDevice: [{ vendorId: 0x10de }] }
        : { auxAttributes: { glRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)" } },
    );
    const out = await resolveGpuNames({ ...base, platform: "win32", arch: "x64", cpuModel: "Intel", getInfo });
    expect(out).toEqual(["NVIDIA GeForce RTX 3080"]);
  });

  it("falls back to system tools when complete info is vendor-only or hangs", async () => {
    vi.useFakeTimers();
    const getInfo = vi.fn((type: string) =>
      type === "basic" ? Promise.resolve({ gpuDevice: [{ vendorId: 0x1002 }] }) : new Promise<never>(() => {}),
    );
    const p = resolveGpuNames({
      ...base,
      platform: "linux",
      arch: "x64",
      cpuModel: "x",
      getInfo,
      systemQuery: async () => ["AMD Radeon RX 6800"],
    });
    await vi.advanceTimersByTimeAsync(3500);
    expect(await p).toEqual(["AMD Radeon RX 6800"]);
    vi.useRealTimers();
  });

  it("keeps the vendor placeholder when nothing better exists", async () => {
    const out = await resolveGpuNames({
      ...base,
      arch: "x64",
      cpuModel: "Intel",
      getInfo: async () => ({ gpuDevice: [{ vendorId: 0x8086 }] }),
      systemQuery: async () => {
        throw new Error("no tool");
      },
    });
    expect(out).toEqual(["Intel GPU"]);
    expect(isVendorOnly(out[0])).toBe(true);
  });
});
