import { describe, it, expect } from "vitest";
import { getGpuTier } from "./device-capabilities";

describe("getGpuTier with native (non-ANGLE) renderer strings", () => {
  it("Apple Silicon: base M1 is mid, Pro/Max and M2+ are high (incl. future M4/M5)", () => {
    expect(getGpuTier("Apple M1")).toBe("mid");
    expect(getGpuTier("Apple M1 Pro")).toBe("high");
    expect(getGpuTier("Apple M1 Max")).toBe("high");
    expect(getGpuTier("Apple M2")).toBe("high");
    expect(getGpuTier("Apple M2 Pro")).toBe("high");
    expect(getGpuTier("Apple M3 Max")).toBe("high");
    expect(getGpuTier("Apple M4")).toBe("high"); // not covered by the original patterns
    expect(getGpuTier("Apple M4 Pro")).toBe("high");
  });

  it("NVIDIA: RTX is high, GTX is mid", () => {
    expect(getGpuTier("NVIDIA GeForce RTX 4080")).toBe("high");
    expect(getGpuTier("NVIDIA GeForce RTX 5090")).toBe("high");
    expect(getGpuTier("NVIDIA GeForce GTX 1660")).toBe("mid");
  });

  it("AMD Radeon RX 6000/7000 is high", () => {
    expect(getGpuTier("AMD Radeon RX 7900 XTX")).toBe("high");
    expect(getGpuTier("AMD Radeon RX 6800")).toBe("high");
  });

  it("integrated Intel is mid; unknown/software is low", () => {
    expect(getGpuTier("Intel UHD Graphics 630")).toBe("mid");
    expect(getGpuTier("Intel Iris Xe Graphics")).toBe("mid");
    expect(getGpuTier("Software Renderer")).toBe("low");
  });

  it("still recognizes ANGLE-wrapped WebGL strings (web path unchanged)", () => {
    expect(getGpuTier("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)")).toBe("high");
  });
});
