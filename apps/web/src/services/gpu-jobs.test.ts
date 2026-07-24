import { describe, it, expect } from "vitest";
import { isTransientGpuError, gpuBackoffMs, TRANSIENT_GPU_CODES } from "./gpu-jobs";

describe("gpu-jobs retry policy", () => {
  it("classifies 5xx/408/429 + network errors as transient", () => {
    expect(isTransientGpuError({ status: 503 })).toBe(true);
    expect(isTransientGpuError({ status: 500 })).toBe(true);
    expect(isTransientGpuError({ status: 408 })).toBe(true);
    expect(isTransientGpuError({ status: 429 })).toBe(true);
    expect(isTransientGpuError({ status: 404 })).toBe(false);
    expect(isTransientGpuError({})).toBe(true);
    expect(TRANSIENT_GPU_CODES.has(429)).toBe(true);
  });
  it("exponential backoff capped at 15s", () => {
    expect(gpuBackoffMs(0, 2000)).toBe(2000);
    expect(gpuBackoffMs(1, 2000)).toBe(4000);
    expect(gpuBackoffMs(2, 2000)).toBe(8000);
    expect(gpuBackoffMs(3, 2000)).toBe(15000);
    expect(gpuBackoffMs(10, 2000)).toBe(15000);
  });
});
