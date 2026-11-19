import { describe, expect, it, vi } from "vitest";
import { canRetryInSoftware, hardwareEncoderFailureMessage, isTransientEncoderError, runWithEncoderRetry } from "./transient-encoder-error";

const encodingError = () => new DOMException("Encoding error.", "EncodingError");

describe("isTransientEncoderError", () => {
  it("recognises Chrome's encoder failures and reclaim errors", () => {
    expect(isTransientEncoderError(encodingError())).toBe(true);
    expect(isTransientEncoderError(new DOMException("Codec reclaimed due to inactivity.", "QuotaExceededError"))).toBe(true);
    expect(isTransientEncoderError({ code: "FRAME_ENCODE_FAILED", message: "Encoding error." })).toBe(true);
  });
  it("does not treat real project or settings failures as transient", () => {
    expect(isTransientEncoderError(new Error("The project snapshot is no longer available."))).toBe(false);
    expect(isTransientEncoderError({ code: "UNSUPPORTED_CODEC", message: "This browser cannot encode H264." })).toBe(false);
    expect(isTransientEncoderError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isTransientEncoderError(null)).toBe(false);
  });
});

describe("runWithEncoderRetry", () => {
  it("runs the job again once after a transient encoder failure and returns the second result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(encodingError()).mockResolvedValueOnce("ok");
    await expect(runWithEncoderRetry(run, { delayMs: 0 })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("tells each run its attempt number so the re-run can switch to a software encoder", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const accelerator = new DOMException("Encoding error. (Failed to initialize video encode accelerator.)", "EncodingError");
    expect(isTransientEncoderError(accelerator)).toBe(true);
    const run = vi.fn(async (attempt: number) => {
      if (attempt === 1) throw accelerator;
      return `software on attempt ${attempt}`;
    });
    await expect(runWithEncoderRetry(run, { delayMs: 0 })).resolves.toBe("software on attempt 2");
    expect(run.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
  });
  it("gives up after the attempts are used and surfaces the last error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(encodingError());
    await expect(runWithEncoderRetry(run, { delayMs: 0 })).rejects.toThrow("Encoding error");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("does not retry other errors, and stops when the caller says the job was cancelled", async () => {
    const other = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runWithEncoderRetry(other, { delayMs: 0 })).rejects.toThrow("boom");
    expect(other).toHaveBeenCalledTimes(1);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cancelled = vi.fn().mockRejectedValue(encodingError());
    await expect(runWithEncoderRetry(cancelled, { delayMs: 0, shouldRetry: () => false })).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("hardware-only retry policy", () => {
  it("only retries in software unless the user chose Hardware", () => {
    expect(canRetryInSoftware(undefined)).toBe(true);
    expect(canRetryInSoftware("auto")).toBe(true);
    expect(canRetryInSoftware("software")).toBe(true);
    expect(canRetryInSoftware("hardware")).toBe(false);
  });
  it("explains why a hardware failure was not retried", () => {
    expect(hardwareEncoderFailureMessage(encodingError())).toMatch(/Encoding error.*not retried in software.*Auto or Software/);
  });
  it("shouldRetry=false for Hardware surfaces the first error without a second run", async () => {
    const run = vi.fn().mockRejectedValue(encodingError());
    await expect(runWithEncoderRetry(run, { delayMs: 0, shouldRetry: () => canRetryInSoftware("hardware") })).rejects.toThrow("Encoding error");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
