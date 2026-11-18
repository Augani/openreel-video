import { describe, expect, it } from "vitest";
import {
  addMotionTextAnimator,
  createMotionTextAnimator,
  getMotionTextAnimatorRuns,
  toggleMotionTextAnimator,
  updateMotionTextAnimator,
} from "./motion-text-animators";
import type { MotionTextLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

const makeTextLayer = (text = "ABC"): MotionTextLayer => ({
  id: "text-1",
  type: "text",
  name: "Headline",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  text,
  style: {
    fontFamily: "Inter",
    fontSize: 96,
    fontWeight: 800,
    color: "#ffffff",
    align: "center",
  },
});

describe("motion text animators", () => {
  it("adds, updates, and toggles text animators immutably", () => {
    const layer = makeTextLayer();
    const animator = createMotionTextAnimator("text-reveal-up", "anim-1");
    const withAnimator = addMotionTextAnimator(layer, animator);
    const updated = updateMotionTextAnimator(
      withAnimator,
      "anim-1",
      (current) => ({
        ...current,
        timing: { ...current.timing, stagger: 0.12 },
      }),
    );
    const disabled = toggleMotionTextAnimator(updated, "anim-1", false);

    expect(layer.textAnimators).toBeUndefined();
    expect(updated.textAnimators?.[0]).toMatchObject({
      id: "anim-1",
      timing: { stagger: 0.12 },
    });
    expect(disabled.textAnimators?.[0]?.enabled).toBe(false);
  });

  it("evaluates staggered character reveal offsets deterministically", () => {
    const layer = addMotionTextAnimator(
      makeTextLayer(),
      {
        ...createMotionTextAnimator("text-reveal-up", "anim-1"),
        timing: {
          startTime: 0,
          duration: 1,
          stagger: 0.25,
          direction: "forward",
          easing: "linear",
        },
      },
    );

    const startRuns = getMotionTextAnimatorRuns(layer, 0);
    const midRuns = getMotionTextAnimatorRuns(layer, 0.5);
    const endRuns = getMotionTextAnimatorRuns(layer, 1.5);

    expect(startRuns[0]).toMatchObject({
      opacity: 0,
      position: { x: 0, y: 36 },
    });
    expect(midRuns[0].opacity).toBe(0.5);
    expect(midRuns[1].opacity).toBe(0.25);
    expect(endRuns.every((run) => run.opacity === 1)).toBe(true);
  });

});
