import { describe, expect, it } from "vitest";
import { runAuroraPreviewSession } from "../src/aurora-host/preview-session";
import type { AuroraPreviewSessionEvent } from "../src/shared/ipc-contract";
import {
  createAuroraFixtureAsset,
  createAuroraFixtureScene,
} from "./aurora-fixture";

describe("Aurora preview session", () => {
  it("emits progressive preview passes before the final frame", async () => {
    const asset = createAuroraFixtureAsset();
    const populatedScene = createAuroraFixtureScene(asset);
    const events: Array<Extract<AuroraPreviewSessionEvent, { kind: "update" }>> = [];

    await runAuroraPreviewSession(
      {
        scene: populatedScene,
        assets: [asset],
        width: 96,
        height: 96,
        background: "#0f172a",
        quality: "preview",
      },
      (event) => events.push({ ...event, sessionId: "aurora-session-test" }),
    );

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.stage)).toEqual(["draft", "refine", "final"]);
    expect(events.at(-1)?.done).toBe(true);
    expect(events.at(-1)?.progress).toBe(1);
    expect(events.every((event) => event.result.dataUri.startsWith("data:image/png;base64,"))).toBe(
      true,
    );
  });
});
