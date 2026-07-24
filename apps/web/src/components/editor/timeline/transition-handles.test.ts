import { describe, it, expect } from "vitest";
import type { Clip, Track, Transition } from "@openreel/core";
import {
  resolveTransitionHandles,
  TRANSITION_ADJACENCY_TOLERANCE,
} from "./transition-handles";

function clip(id: string, startTime: number, duration: number): Clip {
  return { id, startTime, duration } as unknown as Clip;
}

function transition(id: string, clipAId: string, clipBId: string): Transition {
  return {
    id,
    clipAId,
    clipBId,
    type: "crossfade",
    duration: 1,
    params: {},
  } as Transition;
}

function edgeTransition(
  id: string,
  clipAId: string,
  edge: "in" | "out",
): Transition {
  return {
    id,
    clipAId,
    edge,
    type: "crossfade",
    duration: 1,
    params: {},
  } as Transition;
}

function track(clips: Clip[], transitions: Transition[]): Track {
  return { id: "t1", clips, transitions } as unknown as Track;
}

describe("resolveTransitionHandles", () => {
  it("resolves a handle centered on the cut for an adjacent pair", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 2, 3);
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toHaveLength(1);
    const handle = result[0]!;
    expect(handle.transition?.id).toBe("tr");
    expect(handle.clipA.id).toBe("a");
    expect(handle.clipB?.id).toBe("b");
    expect(handle.centerX).toBe(100); // b.startTime(2) * 50
  });

  it("resolves a handle for an adjacent pair with no transition yet", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 2, 3);
    const result = resolveTransitionHandles(track([a, b], []), 50);
    expect(result).toHaveLength(1);
    const handle = result[0]!;
    expect(handle.transition).toBeUndefined();
    expect(handle.clipA.id).toBe("a");
    expect(handle.clipB?.id).toBe("b");
  });

  it("does not resolve a handle when clips are not adjacent", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 5, 3); // 3s gap
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toEqual([]);
  });

  it("does not resolve a handle for a single clip", () => {
    const a = clip("a", 0, 2);
    const result = resolveTransitionHandles(track([a], []), 50);
    expect(result).toEqual([]);
  });

  it("resolves saved intro and outro edge transition handles", () => {
    const a = clip("a", 1, 2);
    const result = resolveTransitionHandles(
      track(
        [a],
        [
          edgeTransition("intro", "a", "in"),
          edgeTransition("outro", "a", "out"),
        ],
      ),
      50,
    );

    expect(result).toHaveLength(2);
    expect(result[0].transition?.id).toBe("intro");
    expect(result[0].edge).toBe("in");
    expect(result[0].centerX).toBe(50);
    expect(result[1].transition?.id).toBe("outro");
    expect(result[1].edge).toBe("out");
    expect(result[1].centerX).toBe(150);
  });

  it("treats sub-tolerance gaps as adjacent", () => {
    const a = clip("a", 0, 2);
    const b = clip("b", 2 + TRANSITION_ADJACENCY_TOLERANCE / 2, 3);
    const result = resolveTransitionHandles(
      track([a, b], [transition("tr", "a", "b")]),
      50,
    );
    expect(result).toHaveLength(1);
  });
});
