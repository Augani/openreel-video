import { describe, expect, it } from "vitest";
import {
  addMotionTextAnimator,
  createMotionTextAnimator,
  getMotionTextShaderAnimator,
  getMotionTextAnimatorGlyphProgress,
  getMotionTextAnimatorRunProgress,
  getMotionTextAnimatorRuns,
  sanitizeMotionTextAnimator,
  layerHasMotionShaderTextAnimator,
} from "./motion-text-animators";
import type { MotionTextAnimator, MotionTextLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { resolveTextShaderPass } from "./motion-renderer";

const makeTextLayer = (text = "ABCDE"): MotionTextLayer => ({
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

const withAnimator = (animator: MotionTextAnimator): MotionTextLayer =>
  addMotionTextAnimator(makeTextLayer(), animator);

describe("motion text shader animator", () => {
  it("finds the shader animator and validates its shader", () => {
    const anim: MotionTextAnimator = {
      ...createMotionTextAnimator("text-reveal-up"),
      shader: { shaderId: "glyph-dissolve", params: { edgeWidth: 0.2 } },
    };
    const layer = withAnimator(anim);
    expect(getMotionTextShaderAnimator(layer)?.shader?.shaderId).toBe("glyph-dissolve");
    expect(layerHasMotionShaderTextAnimator(layer)).toBe(true);
    const bad = sanitizeMotionTextAnimator({
      ...anim,
      shader: { shaderId: "nope", params: {} },
    });
    expect(bad.shader).toBeUndefined();
  });

  it("computes staggered per-glyph progress", () => {
    const anim = createMotionTextAnimator("text-reveal-up");
    const first = getMotionTextAnimatorGlyphProgress(
      anim,
      0,
      5,
      anim.timing.startTime + anim.timing.duration * 0.5,
    );
    const last = getMotionTextAnimatorGlyphProgress(
      anim,
      4,
      5,
      anim.timing.startTime + anim.timing.duration * 0.5,
    );
    expect(first).toBeGreaterThan(last);
  });

  it("computes words+reverse progress using the true word count, not inflated by whitespace", () => {
    const anim: MotionTextAnimator = {
      ...createMotionTextAnimator("text-reveal-up"),
      selector: { basedOn: "words", start: 0, end: 100, offset: 0 },
      timing: { ...createMotionTextAnimator("text-reveal-up").timing, direction: "reverse" },
      shader: { shaderId: "glyph-dissolve", params: {} },
    };
    const layer = { ...makeTextLayer("AB CD EF"), textAnimators: [anim] };
    const localTime = anim.timing.startTime + anim.timing.duration * 0.25;
    const runs = getMotionTextAnimatorRuns(layer, localTime);
    const progress = getMotionTextAnimatorRunProgress(anim, runs, localTime);

    const wordRuns = runs.filter((run) => run.character.trim() !== "");
    const wordCount = 3;
    const expectedByWord = new Map<number, number>();
    for (const run of wordRuns) {
      expectedByWord.set(
        run.unitIndex,
        getMotionTextAnimatorGlyphProgress(anim, run.unitIndex, wordCount, localTime),
      );
    }

    runs.forEach((run, index) => {
      if (run.character.trim() === "") {
        expect(progress[index]).toBe(0);
        return;
      }
      expect(progress[index]).toBe(expectedByWord.get(run.unitIndex));
    });

    const glyphProgress = runs
      .map((run, index) => ({ run, value: progress[index] }))
      .filter((entry) => entry.run.character.trim() !== "")
      .map((entry) => entry.value);
    expect(Math.max(...glyphProgress)).toBeGreaterThan(0);
    const distinctWordValues = new Set(
      wordRuns.map((run) => expectedByWord.get(run.unitIndex)),
    );
    expect(distinctWordValues.size).toBe(3);
  });

  it("resolves the renderer text shader pass for a shader-animator layer", () => {
    const anim: MotionTextAnimator = {
      ...createMotionTextAnimator("text-reveal-up"),
      shader: { shaderId: "glyph-dissolve", params: { edgeWidth: 0.2 } },
    };
    const layer = withAnimator(anim);
    const pass = resolveTextShaderPass(layer, 0);
    expect(pass).not.toBeNull();
    expect(pass?.def.id).toBe("glyph-dissolve");
    expect(pass?.def.category).toBe("text");
    expect(pass?.animator.shader?.shaderId).toBe("glyph-dissolve");
  });

});
