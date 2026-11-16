import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_DECODE_DEADLINE_MS, FrameDecodeTimeoutError, withDecodeDeadline } from "./decode-deadline";

describe("withDecodeDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a decode that answers in time through", async () => {
    const result = withDecodeDeadline(new Promise<string>((resolve) => setTimeout(() => resolve("frame"), 100)));
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("frame");
  });

  it("rejects a decode that never answers, so playback can drop the layer and rebuild its decoder", async () => {
    const result = withDecodeDeadline(new Promise<string>(() => undefined));
    const settled = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(FRAME_DECODE_DEADLINE_MS);
    const error = await settled;
    expect(error).toBeInstanceOf(FrameDecodeTimeoutError);
    expect((error as FrameDecodeTimeoutError).deadlineMs).toBe(FRAME_DECODE_DEADLINE_MS);
  });

  it("keeps the decoder's own errors", async () => {
    const result = withDecodeDeadline(Promise.reject(new Error("decoder disposed")));
    await expect(result).rejects.toThrow("decoder disposed");
  });

  it("does not leave a timer behind once the decode settled", async () => {
    await withDecodeDeadline(Promise.resolve(1));
    expect(vi.getTimerCount()).toBe(0);
  });
});
