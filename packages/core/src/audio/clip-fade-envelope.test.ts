import { describe, expect, it } from "vitest";
import {
  getClipFadeEnvelopePoints,
  scheduleClipFadeEnvelope,
} from "./clip-fade-envelope";
import { vi } from "vitest";

describe("clip fade envelopes", () => {
  it.each([1e-10, 1e-300, Number.MIN_VALUE])(
    "keeps tiny finite fade duration %s next to its edge without non-finite gains",
    (length) => {
      const head = getClipFadeEnvelopePoints({
        clipOffset: 0,
        rangeDuration: 1,
        clipDuration: 1,
        fadeIn: length,
      });
      expect(head).toEqual([
        { time: 0, value: 0 },
        { time: length, value: 1 },
        { time: 1, value: 1 },
      ]);
      const tail = getClipFadeEnvelopePoints({
        clipOffset: 0,
        rangeDuration: 1,
        clipDuration: 1,
        fadeOut: length,
      });
      expect(
        tail.every(
          (point) =>
            Number.isFinite(point.time) && Number.isFinite(point.value),
        ),
      ).toBe(true);
      expect(tail.at(-1)).toEqual({ time: 1, value: 0 });
      expect(tail.at(-2)!.time).toBeGreaterThan(1 - 1e-9);
      expect(tail.at(-2)!.value).toBe(1);
    },
  );

  it("keeps fade timing clip-local when rendering a middle chunk", () => {
    expect(
      getClipFadeEnvelopePoints({
        clipOffset: 4,
        rangeDuration: 2,
        clipDuration: 10,
        fadeIn: 2,
        fadeOut: 2,
      }),
    ).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("returns the correct partial fade when playback begins inside it", () => {
    expect(
      getClipFadeEnvelopePoints({
        clipOffset: 1,
        rangeDuration: 2,
        clipDuration: 10,
        fadeIn: 2,
      }),
    ).toEqual([
      { time: 0, value: 0.5 },
      { time: 1, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("schedules a clip-end fade relative to the requested range", () => {
    expect(
      getClipFadeEnvelopePoints({
        clipOffset: 7,
        rangeDuration: 3,
        clipDuration: 10,
        fadeOut: 2,
      }),
    ).toEqual([
      { time: 0, value: 1 },
      { time: 1, value: 1 },
      { time: 3, value: 0 },
    ]);
  });

  it("retains the audible intersection of overlapping fade-in and fade-out", () => {
    expect(
      getClipFadeEnvelopePoints({
        clipOffset: 0,
        rangeDuration: 5,
        clipDuration: 5,
        fadeIn: 5,
        fadeOut: 5,
      }),
    ).toEqual([
      { time: 0, value: 0 },
      { time: 2.5, value: 0.5 },
      { time: 5, value: 0 },
    ]);
    const gain = {
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    };
    scheduleClipFadeEnvelope(gain as unknown as AudioParam, {
      startTime: 12,
      clipOffset: 0,
      rangeDuration: 5,
      clipDuration: 5,
      fadeIn: 5,
      fadeOut: 5,
    });
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 12);
    expect(gain.linearRampToValueAtTime.mock.calls).toEqual([
      [0.5, 14.5],
      [0, 17],
    ]);
  });

  it.each([
    { clipDuration: 4, fadeIn: 3, fadeOut: 2 },
    {
      clipDuration: 5,
      fadeIn: 4,
      fadeOut: 5,
      fadeOrigin: { offset: 3, duration: 10 },
      transitionFadeIn: 3,
      transitionFadeOut: 3,
    },
    {
      clipDuration: 2,
      fadeIn: 2,
      fadeOut: 4,
      fadeOrigin: { offset: 8, duration: 10 },
      transitionFadeIn: 0.5,
    },
    {
      clipDuration: 4,
      fadeIn: 2,
      fadeOut: 2,
      fadeOrigin: { offset: -1, duration: 10 },
    },
    {
      clipDuration: 3,
      fadeIn: 1,
      fadeOut: 4,
      fadeOrigin: { offset: 7, duration: 12, fadeIn: false },
    },
    {
      clipDuration: 3,
      fadeIn: 5,
      fadeOut: 2,
      fadeOrigin: { offset: 2, duration: 10, fadeOut: false },
      transitionFadeIn: 1.5,
    },
    {
      clipDuration: 2,
      fadeIn: 5,
      fadeOut: 5,
      fadeOrigin: { offset: 4, duration: 10 },
      transitionFadeIn: 1.5,
      transitionFadeOut: 1.5,
    },
    { clipDuration: 5, transitionFadeIn: 4, transitionFadeOut: 3 },
  ])(
    "matches the original user clock and local transition ramps throughout %#",
    (settings) => {
      const options: Parameters<typeof getClipFadeEnvelopePoints>[0] = {
        clipOffset: 0,
        rangeDuration: settings.clipDuration,
        ...settings,
      };
      const points = getClipFadeEnvelopePoints(options);
      const sample = (time: number) => {
        const right = points.findIndex((point) => point.time >= time);
        if (right === 0) return points[0].value;
        const a = points[right - 1],
          b = points[right];
        return (
          a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time)
        );
      };
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      const origin = options.fadeOrigin ?? {
        offset: 0,
        duration: options.clipDuration,
      };
      for (let i = 0; i <= 500; i++) {
        const time = (options.clipDuration * i) / 500;
        const expected = Math.min(
          options.fadeIn
            ? clamp(
                (time + (origin.fadeIn === false ? 0 : origin.offset)) /
                  options.fadeIn,
              )
            : 1,
          options.fadeOut
            ? clamp(
                ((origin.fadeOut === false
                  ? options.clipDuration
                  : origin.duration - origin.offset) -
                  time) /
                  options.fadeOut,
              )
            : 1,
          options.transitionFadeIn ? clamp(time / options.transitionFadeIn) : 1,
          options.transitionFadeOut
            ? clamp((options.clipDuration - time) / options.transitionFadeOut)
            : 1,
        );
        expect(sample(time)).toBeCloseTo(expected, 10);
      }
    },
  );

  it("keeps chunk and internal-piece fade samples on the original clock", () => {
    const points = getClipFadeEnvelopePoints({
      clipOffset: 0.3,
      rangeDuration: 1.3,
      clipDuration: 2,
      fadeOut: 4,
      fadeOrigin: { offset: 8, duration: 10 },
    });
    expect(points).toHaveLength(2);
    expect(points[0].time).toBe(0);
    expect(points[0].value).toBeCloseTo(0.425);
    expect(points[1].time).toBeCloseTo(1.3);
    expect(points[1].value).toBeCloseTo(0.1);
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite render range %s without scheduling invalid points",
    (rangeDuration) => {
      expect(
        getClipFadeEnvelopePoints({
          clipOffset: 0,
          rangeDuration,
          clipDuration: 2,
          fadeIn: 1,
        }),
      ).toEqual([]);
    },
  );
});
