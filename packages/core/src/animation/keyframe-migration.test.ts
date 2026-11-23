import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import { AnimationEngine } from "../video/animation-engine";
import { KeyframeEngine } from "../video/keyframe-engine";
import { migrateLegacyKeyframeEasings, normalizeProjectKeyframeEasings } from "./keyframe-migration";
import { normalizeProjectStoredFields } from "../storage/project-serializer";

const legacy = (easing: Keyframe["easing"]): Keyframe[] => [
  { id: "a", time: 0, property: "opacity", value: 0.1, easing },
  { id: "b", time: 2, property: "opacity", value: 0.9, easing: "ease-out" },
  { id: "c", time: 3.5, property: "opacity", value: 0.3, easing: "linear" },
];

describe("legacy easing migration", () => {
  const classic = new KeyframeEngine();
  const anim = new AnimationEngine();
  const times = Array.from({ length: 141 }, (_, i) => (3.5 * i) / 140);

  for (const easing of ["linear", "ease-in", "ease-out", "ease-in-out", "hold", "easeInCubic", "smoothstep"] as const) {
    it(`${easing}: migrated keys evaluate identically in both engines at every sampled time`, () => {
      const before = legacy(easing);
      const after = migrateLegacyKeyframeEasings(before);
      for (const t of times) {
        expect(classic.getValueAtTime(after, t).value as number).toBeCloseTo(classic.getValueAtTime(before, t).value as number, 8);
        expect(anim.getValueAtTime(after, t).value as number).toBeCloseTo(anim.getValueAtTime(before, t).value as number, 8);
        expect(anim.getValueAtTime(after, t).value as number).toBeCloseTo(classic.getValueAtTime(before, t).value as number, 8);
      }
    });
  }

  it("ease-in and ease-out become exact Bezier handles; the rest are untouched", () => {
    const out = migrateLegacyKeyframeEasings(legacy("ease-in"));
    expect(out[0]).toMatchObject({ easing: "bezier", bezierHandles: { in: { x: 1 / 3, y: 0 }, out: { x: 2 / 3, y: 1 / 3 } } });
    expect(out[1].easing).toBe("bezier");
    expect(out[2].easing).toBe("linear");
    const same = legacy("ease-in-out");
    const inOut = migrateLegacyKeyframeEasings(same);
    expect(inOut[0].easing).toBe("ease-in-out");
    expect(migrateLegacyKeyframeEasings(legacy("hold"))[0].easing).toBe("hold");
  });

  it("returns the same array when nothing changes and is idempotent", () => {
    const plain = legacy("linear").slice(0, 1);
    expect(migrateLegacyKeyframeEasings(plain)).toBe(plain);
    const once = migrateLegacyKeyframeEasings(legacy("ease-in"));
    expect(migrateLegacyKeyframeEasings(once)).toBe(once);
  });

  it("never replaces hand-set handles", () => {
    const handles = { in: { x: 0.2, y: 0.4 }, out: { x: 0.6, y: 0.9 } };
    const keys: Keyframe[] = [{ id: "a", time: 0, property: "opacity", value: 0, easing: "ease-in", bezierHandles: handles }];
    expect(migrateLegacyKeyframeEasings(keys)[0].bezierHandles).toBe(handles);
  });

  const projectWith = (keyframes: Keyframe[]): Project =>
    ({
      timeline: { tracks: [{ id: "t", clips: [{ id: "c", effects: [], keyframes }] }] },
      sequences: [{ id: "s", timeline: { tracks: [{ id: "t2", clips: [{ id: "c2", effects: [], keyframes }] }] } }],
    }) as unknown as Project;

  it("runs on project load for the timeline and stored sequences", () => {
    const loaded = normalizeProjectStoredFields(projectWith(legacy("ease-in")));
    expect(loaded.timeline.tracks[0].clips[0].keyframes[0].easing).toBe("bezier");
    expect(loaded.sequences?.[0].timeline.tracks[0].clips[0].keyframes[0].easing).toBe("bezier");
    const again = normalizeProjectKeyframeEasings(loaded);
    expect(again).toBe(loaded);
  });
});
