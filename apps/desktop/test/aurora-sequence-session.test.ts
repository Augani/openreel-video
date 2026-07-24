import { describe, expect, it } from "vitest";
import { runAuroraSequenceSession } from "../src/aurora-host/sequence-session";
import type { AuroraSequenceSessionEvent } from "../src/shared/ipc-contract";
import {
  createAuroraFixtureAsset,
  createAuroraFixtureScene,
} from "./aurora-fixture";

describe("Aurora sequence session", () => {
  it("emits rendered frames across the requested duration", async () => {
    const asset = createAuroraFixtureAsset();
    const scene = createAuroraFixtureScene(asset);
    const events: Array<Extract<AuroraSequenceSessionEvent, { kind: "frame" }>> = [];

    await runAuroraSequenceSession(
      {
        scene,
        assets: [asset],
        width: 96,
        height: 96,
        frameRate: 2,
        durationSeconds: 1.5,
        background: "#0f172a",
        quality: "final",
      },
      (event) => events.push({ ...event, sessionId: "aurora-sequence-test" }),
    );

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.frameIndex)).toEqual([0, 1, 2]);
    expect(events.map((event) => event.timeSeconds)).toEqual([0, 0.5, 1]);
    expect(events.at(-1)?.done).toBe(true);
    expect(events.at(-1)?.progress).toBe(1);
    expect(events.every((event) => event.result.rgba.byteLength > 0)).toBe(true);
  });
});
