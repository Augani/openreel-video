import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "../../stores/timeline-store";

const decode = vi.fn(async () => document.createElement("canvas"));
vi.mock("./playhead-frame", () => ({ decodePlayheadFrame: (...args: unknown[]) => (decode as unknown as (...a: unknown[]) => unknown)(...args) }));

afterEach(() => {
  vi.useRealTimers();
  decode.mockClear();
});

describe("shared playhead backdrop", () => {
  it("decodes the playhead frame once for every card that asks for it", async () => {
    vi.useFakeTimers();
    const { usePlayheadBackdrop } = await import("./playhead-backdrop");
    const cards = Array.from({ length: 12 }, () => renderHook(() => usePlayheadBackdrop()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(decode).toHaveBeenCalledTimes(1);
    const first = cards[0].result.current;
    expect(first).toBeInstanceOf(HTMLCanvasElement);
    for (const card of cards) expect(card.result.current).toBe(first);
    // Playing never decodes.
    act(() => useTimelineStore.setState({ playbackState: "playing" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(decode).toHaveBeenCalledTimes(1);
    act(() => useTimelineStore.setState({ playbackState: "paused" }));
    for (const card of cards) card.unmount();
  });
});
