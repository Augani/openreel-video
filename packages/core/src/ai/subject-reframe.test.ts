import { describe, it, expect } from "vitest";
import type { Keyframe } from "../types/timeline";
import {
  buildReframeKeyframes,
  createPersonSubjectDetector,
  mergeReframeKeyframes,
  positionForFocus,
  reframeSampleTimes,
  sampleSubjects,
  smoothSubjectPath,
  subjectFromMask,
  visibleSourceRect,
  type ReframeGeometry,
  type SubjectBox,
  type SubjectDetector,
  type SubjectSample,
} from "./subject-reframe";

const GEO: ReframeGeometry = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  projectWidth: 1080,
  projectHeight: 1920,
};

function box(cx: number, cy = 0.5, size = 0.2): SubjectBox {
  return { cx, cy, width: size, height: size * 1.8, area: size * size };
}

function maskWith(
  width: number,
  height: number,
  rects: Array<[number, number, number, number]>,
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { data, width, height };
}

const fakeFrame = {} as ImageBitmap;
const frames = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ bitmap: fakeFrame, time: i / 3 }));

describe("subjectFromMask", () => {
  it("returns the bounding box and centre of a single subject", () => {
    const s = subjectFromMask(maskWith(100, 100, [[20, 30, 40, 70]]))!;
    expect(s.cx).toBeCloseTo(0.3, 2);
    expect(s.cy).toBeCloseTo(0.5, 2);
    expect(s.width).toBeCloseTo(0.2, 2);
    expect(s.height).toBeCloseTo(0.4, 2);
  });

  it("returns null for an empty matte", () => {
    expect(subjectFromMask(maskWith(50, 50, []))).toBeNull();
  });

  it("rejects sparse speckle and thin strips as matte noise", () => {
    const width = 100;
    const speckle = maskWith(width, 100, []);
    for (let y = 5; y < 90; y += 3) for (let x = 5; x < 90; x += 3) speckle.data[(y * width + x) * 4 + 3] = 255;
    expect(subjectFromMask(speckle)).toBeNull();
    expect(subjectFromMask(maskWith(100, 100, [[5, 88, 95, 98]]))).toBeNull();
  });

  it("picks the largest of several subjects", () => {
    const s = subjectFromMask(
      maskWith(100, 100, [
        [5, 40, 15, 60],
        [60, 20, 90, 80],
      ]),
    )!;
    expect(s.cx).toBeCloseTo(0.75, 2);
  });

  it("prefers the more central subject when sizes are equal", () => {
    const s = subjectFromMask(
      maskWith(100, 100, [
        [2, 40, 22, 60],
        [40, 40, 60, 60],
      ]),
    )!;
    expect(s.cx).toBeCloseTo(0.5, 2);
  });
});

describe("sampleSubjects", () => {
  it("uses the person detector when available", async () => {
    const primary: SubjectDetector = async () => box(0.7);
    const fallback: SubjectDetector = async () => box(0.1);
    const out = await sampleSubjects(frames(3), { subject: "auto", primary, fallback });
    expect(out.every((s) => s.source === "person" && s.subject?.cx === 0.7)).toBe(true);
  });

  it("falls back to the heuristic when segmentation is unavailable", async () => {
    const primary: SubjectDetector = async () => {
      throw new Error("no model");
    };
    const fallback: SubjectDetector = async () => box(0.2);
    const out = await sampleSubjects(frames(3), { subject: "person", primary, fallback });
    expect(out.every((s) => s.source === "heuristic")).toBe(true);
  });

  it("falls back when no primary detector is given", async () => {
    const out = await sampleSubjects(frames(2), {
      subject: "person",
      primary: null,
      fallback: async () => box(0.4),
    });
    expect(out[0].source).toBe("heuristic");
  });

  it("auto falls back per frame, person mode does not", async () => {
    const primary: SubjectDetector = async () => null;
    const fallback: SubjectDetector = async () => box(0.3);
    const auto = await sampleSubjects(frames(2), { subject: "auto", primary, fallback });
    const person = await sampleSubjects(frames(2), { subject: "person", primary, fallback });
    expect(auto[0].source).toBe("heuristic");
    expect(person[0].source).toBe("none");
    expect(person[0].subject).toBeNull();
  });

  it("createPersonSubjectDetector throws when the model is not initialized", async () => {
    const det = createPersonSubjectDetector(
      { isInitialized: () => false, getPersonMask: async () => null },
      "s",
    );
    await expect(det(fakeFrame, 0)).rejects.toThrow();
  });

  it("createPersonSubjectDetector reduces the matte to a box", async () => {
    const det = createPersonSubjectDetector(
      {
        isInitialized: () => true,
        getPersonMask: async () => ({ mask: maskWith(100, 100, [[60, 20, 80, 80]]) }),
      },
      "s",
    );
    expect((await det(fakeFrame, 0))!.cx).toBeCloseTo(0.7, 2);
  });
});

function samplesFor(xs: Array<number | null>, fps = 3): SubjectSample[] {
  return xs.map((x, i) => ({
    time: i / fps,
    subject: x === null ? null : box(x),
    source: x === null ? "none" : "person",
  }));
}

describe("smoothSubjectPath", () => {
  it("follows a moving subject", () => {
    const xs = Array.from({ length: 30 }, (_, i) => 0.2 + (0.6 * i) / 29);
    const path = smoothSubjectPath(samplesFor(xs), "default");
    expect(path[0].x).toBeCloseTo(0.2, 2);
    expect(path[29].x).toBeGreaterThan(0.5);
    for (let i = 1; i < path.length; i++) expect(path[i].x).toBeGreaterThanOrEqual(path[i - 1].x);
  });

  it("does not move for jitter inside the dead zone", () => {
    const xs = Array.from({ length: 20 }, (_, i) => 0.5 + (i % 2 ? 0.02 : -0.02));
    const path = smoothSubjectPath(samplesFor(xs), "default");
    const range = Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x));
    expect(range).toBeLessThan(1e-9);
  });

  it("faster preset reacts more than slower to a step", () => {
    const xs = [0.3, 0.3, 0.3, 0.8, 0.8, 0.8];
    const slow = smoothSubjectPath(samplesFor(xs), "slower");
    const fast = smoothSubjectPath(samplesFor(xs), "faster");
    expect(fast[4].x).toBeGreaterThan(slow[4].x);
    expect(slow[4].x).toBeGreaterThan(0.3);
  });

  it("ignores a single-frame detection glitch", () => {
    const xs = [0.3, 0.3, 0.3, 0.98, 0.3, 0.3, 0.3];
    const path = smoothSubjectPath(samplesFor(xs), "faster");
    expect(Math.max(...path.map((p) => p.x))).toBeLessThan(0.31);
  });

  it("holds the last position through missed detections", () => {
    const path = smoothSubjectPath(samplesFor([0.3, 0.3, null, null, null]), "default");
    expect(path[4].x).toBeCloseTo(0.3, 5);
  });

  it("centres when follow is off", () => {
    const path = smoothSubjectPath(samplesFor([0.1, 0.9]), "default", { follow: false });
    expect(path.every((p) => p.x === 0.5)).toBe(true);
  });

  it("centre bias pulls the target toward the middle", () => {
    const a = smoothSubjectPath(samplesFor([0.9, 0.9, 0.9, 0.9]), "faster");
    const b = smoothSubjectPath(samplesFor([0.9, 0.9, 0.9, 0.9]), "faster", { centerBias: 0.5 });
    expect(b[0].x).toBeLessThan(a[0].x);
  });
});

describe("buildReframeKeyframes", () => {
  it("crop follows a moving subject and keeps it inside the output", () => {
    const xs = Array.from({ length: 31 }, (_, i) => 0.2 + (0.6 * i) / 30);
    const samples = samplesFor(xs);
    const path = smoothSubjectPath(samples, "faster");
    const kfs = buildReframeKeyframes("c1", path, GEO);
    const px = kfs.filter((k) => k.property === "position.x");
    expect(px.length).toBeGreaterThan(2);
    expect(px[0].value as number).toBeGreaterThan(px[px.length - 1].value as number);
    const scale = kfs.find((k) => k.property === "scale.x")!.value as number;
    expect(scale).toBeCloseTo(1920 / (1080 * (9 / 16)) , 1);
    for (let i = 0; i < path.length; i++) {
      const pos = positionForFocus({ x: path[i].x, y: path[i].y }, GEO);
      const rect = visibleSourceRect(pos, pos.scale, GEO);
      const subjectX = samples[i].subject!.cx;
      // The subject lags the smoothed camera, but must stay inside the crop.
      expect(subjectX).toBeGreaterThanOrEqual(rect.left - 1e-6);
      expect(subjectX).toBeLessThanOrEqual(rect.right + 1e-6);
    }
  });

  it("clamps so the crop never leaves the source", () => {
    const pos = positionForFocus({ x: 0, y: 0.5 }, GEO);
    const rect = visibleSourceRect(pos, pos.scale, GEO);
    expect(rect.left).toBeGreaterThanOrEqual(-1e-6);
    const pos2 = positionForFocus({ x: 1, y: 0.5 }, GEO);
    expect(visibleSourceRect(pos2, pos2.scale, GEO).right).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("replaces old transform keyframes but keeps other properties", () => {
    const existing: Keyframe[] = [
      { id: "a", time: 0, property: "position.x", value: 5, easing: "linear" },
      { id: "b", time: 1, property: "opacity", value: 0.5, easing: "linear" },
    ];
    const kfs = buildReframeKeyframes("c1", smoothSubjectPath(samplesFor([0.4, 0.6]), "default"), GEO, existing);
    expect(kfs.find((k) => k.id === "a")).toBeUndefined();
    expect(kfs.find((k) => k.id === "b")).toBeDefined();
  });

  it("emits few keyframes for a static subject", () => {
    const kfs = buildReframeKeyframes("c1", smoothSubjectPath(samplesFor(new Array(30).fill(0.4)), "default"), GEO);
    expect(kfs.filter((k) => k.property === "position.x").length).toBe(2);
  });
});

describe("reframeSampleTimes", () => {
  it("samples at ~3 fps and includes the end", () => {
    const t = reframeSampleTimes(3);
    expect(t.length).toBe(10);
    expect(t[t.length - 1]).toBe(3);
  });
  it("caps very long clips", () => {
    expect(reframeSampleTimes(3600).length).toBeLessThanOrEqual(242);
  });
});

describe("mergeReframeKeyframes", () => {
  const kf = (id: string, property: string, value: number): Keyframe => ({
    id,
    time: 0,
    property,
    value,
    easing: "linear",
  });
  it("keeps edits made to other properties while tracking ran and replaces transform tracks", () => {
    const merged = mergeReframeKeyframes(
      [kf("a", "opacity", 0.5), kf("b", "position.x", 99)],
      [kf("n1", "position.x", 10), kf("n2", "opacity", 1)],
    );
    expect(merged.map((k) => k.id)).toEqual(["a", "n1"]);
  });
  it("handles a clip with no keyframes", () => {
    expect(mergeReframeKeyframes(undefined, [kf("n", "scale.x", 2)])).toHaveLength(1);
  });
});
