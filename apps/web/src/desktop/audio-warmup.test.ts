import { describe, expect, it, vi } from "vitest";
import { warmAudioDevices } from "./audio-warmup";

describe("warmAudioDevices", () => {
  it("starts one asynchronous device enumeration and does not wait for it", () => {
    let resolve!: (value: unknown) => void;
    const enumerateDevices = vi.fn(() => new Promise((r) => (resolve = r)));
    expect(warmAudioDevices({ mediaDevices: { enumerateDevices } })).toBeUndefined();
    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    resolve([]);
  });

  it("swallows a rejected enumeration (no unhandled rejection)", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    warmAudioDevices({ mediaDevices: { enumerateDevices: () => Promise.reject(new Error("denied")) } });
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("swallows a synchronous throw and tolerates a missing mediaDevices", () => {
    expect(() =>
      warmAudioDevices({
        mediaDevices: {
          enumerateDevices: () => {
            throw new Error("boom");
          },
        },
      }),
    ).not.toThrow();
    expect(() => warmAudioDevices({})).not.toThrow();
    expect(() => warmAudioDevices(undefined)).not.toThrow();
  });
});
