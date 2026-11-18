import { describe, expect, it, vi } from "vitest";
import { isTransientEncoderError, runWithEncoderRetry } from "./transient-encoder-error";

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
