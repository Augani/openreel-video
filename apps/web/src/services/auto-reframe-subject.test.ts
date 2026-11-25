import { describe, it, expect, vi } from "vitest";
import type { Clip, MediaItem, SubjectDetector } from "@openreel/core";
import { computeSubjectReframe } from "./auto-reframe-subject";

const clip = {
  id: "c1",
  mediaId: "m1",
  duration: 3,
  inPoint: 0,
  outPoint: 3,
  keyframes: [],
  transform: { fitMode: "contain" },
} as unknown as Clip;
const media = { id: "m1", type: "video" } as unknown as MediaItem;

const videoEngine = {
  decodeFrame: vi.fn(async () => ({ width: 1920, height: 1080, close: vi.fn() }) as unknown as ImageBitmap),
};

const base = {
  clip,
  media,
  videoEngine,
  projectWidth: 1080,
  projectHeight: 1920,
  subject: "person" as const,
  motion: "faster" as const,
  follow: true,
  centerBias: 0,
};

describe("computeSubjectReframe", () => {
  it("produces transform keyframes that follow a moving subject", async () => {
    let n = 0;
    const detector: SubjectDetector = async () => ({
      cx: 0.2 + 0.06 * n++,
      cy: 0.5,
      width: 0.15,
      height: 0.4,
      area: 0.05,
    });
    const out = await computeSubjectReframe({ ...base, primaryDetector: detector });
    expect(out.personFrames).toBe(out.samples.length);
    const px = out.keyframes.filter((k) => k.property === "position.x");
    expect(px[0].value as number).toBeGreaterThan(px[px.length - 1].value as number);
    expect(out.keyframes.some((k) => k.property === "scale.x")).toBe(true);
  });

  it("does not crash and centres when no detector or heuristic is available", async () => {
    const detector: SubjectDetector = async () => {
      throw new Error("model unavailable");
    };
    const out = await computeSubjectReframe({ ...base, primaryDetector: detector });
    expect(out.personFrames).toBe(0);
    const px = out.keyframes.filter((k) => k.property === "position.x");
    expect(px.every((k) => k.value === px[0].value)).toBe(true);
  });

  it("follow off yields a static centred crop", async () => {
    const detector = vi.fn(async () => ({ cx: 0.9, cy: 0.5, width: 0.1, height: 0.3, area: 0.03 }));
    const out = await computeSubjectReframe({ ...base, follow: false, primaryDetector: detector });
    expect(detector).not.toHaveBeenCalled();
    expect(out.keyframes.find((k) => k.property === "position.x")!.value).toBeCloseTo(0, 5);
  });
});
