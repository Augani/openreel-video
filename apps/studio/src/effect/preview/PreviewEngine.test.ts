import { describe, it, expect, vi } from "vitest";
import { PreviewEngine } from "./PreviewEngine";
import { VideoSource } from "./VideoSource";
import { emptyScene } from "../scene";
import { registerAllBehaviors } from "../behaviors/registry";

registerAllBehaviors();

vi.mock("./DetectorPool", () => ({
  DetectorPool: vi.fn().mockImplementation(() => ({
    ensure: vi.fn(async () => undefined),
    releaseUnused: vi.fn(),
    disposeAll: vi.fn(),
    has: vi.fn(() => false),
    get: vi.fn(),
  })),
}));

describe("PreviewEngine", () => {
  it("emits a perf event after running a render tick", async () => {
    const canvas = document.createElement("canvas");
    const source = VideoSource.fromSampleClip({
      id: "portrait-closeup-01",
      label: "PC",
      aspect: "9:16",
      durationSec: 10,
      url: "",
      tests: [],
    });
    const engine = new PreviewEngine(canvas);
    const perfEvents: number[] = [];
    engine.onPerf((p) => perfEvents.push(p.frameMs));
    engine.setSource(source);
    engine.setScene(emptyScene());
    await engine.tickOnce({ now: 16 });
    expect(perfEvents).toHaveLength(1);
    engine.dispose();
  });

  it("reads the right detector kinds from the scene", () => {
    const canvas = document.createElement("canvas");
    const engine = new PreviewEngine(canvas);
    engine.setScene({
      sampleClipId: "x",
      subjects: [{ id: "s1", kind: "face", name: "Face", visible: true, behaviors: [] }],
    });
    expect(engine.activeDetectorKinds()).toEqual(["FaceLandmarker"]);
    engine.dispose();
  });
});
