import { describe, expect, it } from "vitest";
import {
  spliceTimelineRange,
  projectRangeThroughSlices,
  type TimelineSlice,
} from "./timeline-splice";

const at = (pieces: TimelineSlice[], time: number) => {
  const piece = pieces.find(
    (piece) =>
      time >= piece.startTime - 1e-9 &&
      time < piece.startTime + piece.duration - 1e-9,
  );
  if (!piece) throw new Error("The sample falls in a gap.");
  return piece.fromTime + time - piece.startTime;
};
describe("source-aware ripple interval projection", () => {
  it("inserts the revealed tail into longer audio without slipping later video cuts", () => {
    const audio = spliceTimelineRange(
      { startTime: 8, duration: 12 },
      { type: "insert", at: 14, duration: 1, fromTime: 14 },
      { fillInsertion: true },
    );
    expect(audio).toEqual([
      { startTime: 8, duration: 6, fromTime: 8, inserted: false },
      { startTime: 14, duration: 1, fromTime: 14, inserted: true },
      { startTime: 15, duration: 6, fromTime: 14, inserted: false },
    ]);
    const source = (oldTime: number) => (oldTime - 8) * 2;
    for (const [time, expected] of [
      [13.5, 11],
      [14.5, 13],
      [15.5, 13],
      [19, 20],
    ])
      expect(source(at(audio, time))).toBe(expected);
    // The following video retains source12 at its shifted timeline start15.
    expect(source(at(audio, 15))).toBe(12);
  });
  it.each([false, true])(
    "removes a head interval with source continuity, reversed=%s",
    (reversed) => {
      const audio = spliceTimelineRange(
        { startTime: 8, duration: 8 },
        { type: "remove", start: 10, end: 11 },
      );
      const source = (time: number) =>
        reversed ? 16 - (time - 8) * 2 : (time - 8) * 2;
      expect(audio).toEqual([
        { startTime: 8, duration: 2, fromTime: 8, inserted: false },
        { startTime: 10, duration: 5, fromTime: 11, inserted: false },
      ]);
      for (const time of [10, 10.25, 12.5, 14.75])
        expect(source(at(audio, time))).toBe(source(time + 1));
    },
  );
  it("reveals the earlier head interval while preserving lead-in and following clocks", () => {
    const audio = spliceTimelineRange(
      { startTime: 8, duration: 12 },
      { type: "insert", at: 10, duration: 1, fromTime: 9 },
      { fillInsertion: true },
    );
    expect(at(audio, 9.5)).toBe(9.5);
    expect(at(audio, 10.5)).toBe(9.5);
    expect(at(audio, 11.5)).toBe(10.5);
  });
  it("keeps following clips intact and shifts them only once", () => {
    expect(
      spliceTimelineRange(
        { startTime: 14, duration: 4 },
        { type: "insert", at: 14, duration: 1, fromTime: 14 },
        { fillInsertion: true },
      ),
    ).toEqual([{ startTime: 15, duration: 4, fromTime: 14, inserted: false }]);
    expect(
      spliceTimelineRange(
        { startTime: 14, duration: 4 },
        { type: "remove", start: 13, end: 14 },
      ),
    ).toEqual([{ startTime: 13, duration: 4, fromTime: 14, inserted: false }]);
  });
  it("fills aligned edges only when the caller owns that edit point", () => {
    const edit = { type: "insert" as const, at: 10, duration: 1, fromTime: 9 };
    expect(
      spliceTimelineRange({ startTime: 10, duration: 4 }, edit, {
        fillInsertion: true,
      }),
    ).toHaveLength(1);
    expect(
      spliceTimelineRange({ startTime: 10, duration: 4 }, edit, {
        fillInsertion: true,
        fillAtStart: true,
      })[0],
    ).toEqual({ startTime: 10, duration: 1, fromTime: 9, inserted: true });
    expect(
      spliceTimelineRange({ startTime: 8, duration: 2 }, edit, {
        fillInsertion: true,
        fillAtEnd: true,
      })[1].inserted,
    ).toBe(true);
  });
  it("leaves inserted time empty for unrelated source content", () => {
    const audio = spliceTimelineRange(
      { startTime: 8, duration: 8 },
      { type: "insert", at: 10, duration: 1, fromTime: 10 },
    );
    expect(
      audio.map((piece) => [piece.startTime, piece.duration, piece.fromTime]),
    ).toEqual([
      [8, 2, 8],
      [11, 6, 10],
    ]);
    expect(() => at(audio, 10.5)).toThrow(/gap/);
  });
  it("removes, trims or retains clips at each side of a deleted interval", () => {
    const edit = { type: "remove" as const, start: 10, end: 12 };
    expect(spliceTimelineRange({ startTime: 10, duration: 2 }, edit)).toEqual(
      [],
    );
    expect(spliceTimelineRange({ startTime: 9, duration: 2 }, edit)).toEqual([
      { startTime: 9, duration: 1, fromTime: 9, inserted: false },
    ]);
    expect(spliceTimelineRange({ startTime: 11, duration: 2 }, edit)).toEqual([
      { startTime: 10, duration: 1, fromTime: 12, inserted: false },
    ]);
    expect(spliceTimelineRange({ startTime: 4, duration: 2 }, edit)).toEqual([
      { startTime: 4, duration: 2, fromTime: 4, inserted: false },
    ]);
  });
  it("projects repeated and partially removed caption ranges without inventing text", () => {
    const repeated = spliceTimelineRange(
      { startTime: 8, duration: 12 },
      { type: "insert", at: 14, duration: 1, fromTime: 14 },
      { fillInsertion: true },
    );
    expect(
      projectRangeThroughSlices({ startTime: 14.25, duration: 0.5 }, repeated),
    ).toEqual([
      { startTime: 14.25, duration: 0.5, fromTime: 14.25, inserted: true },
      { startTime: 15.25, duration: 0.5, fromTime: 14.25, inserted: false },
    ]);
    const removed = spliceTimelineRange(
      { startTime: 8, duration: 12 },
      { type: "remove", start: 13, end: 14 },
    );
    expect(
      projectRangeThroughSlices({ startTime: 12.5, duration: 2 }, removed).map(
        (piece) => [piece.startTime, piece.duration, piece.fromTime],
      ),
    ).toEqual([
      [12.5, 0.5, 12.5],
      [13, 0.5, 14],
    ]);
  });
  it("retains subframe audio fragments and accepts earlier source handles", () => {
    const audio = spliceTimelineRange(
      { startTime: 0, duration: 1 },
      { type: "insert", at: 0, duration: 0.01, fromTime: -0.01 },
      { fillInsertion: true, fillAtStart: true },
    );
    expect(audio[0]).toMatchObject({ duration: 0.01, fromTime: -0.01 });
    expect(
      spliceTimelineRange(
        { startTime: 0, duration: 1 },
        { type: "remove", start: 0.00002, end: 0.99998 },
      ),
    ).toHaveLength(2);
  });
  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite edit distances %s",
    (duration) => {
      expect(() =>
        spliceTimelineRange(
          { startTime: 0, duration: 1 },
          { type: "insert", at: 0.5, duration, fromTime: 0.5 },
        ),
      ).toThrow(/finite/);
    },
  );
});
