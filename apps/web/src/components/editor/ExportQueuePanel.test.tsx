import { describe, expect, it } from "vitest";
import { smartRenderDetail } from "./ExportQueuePanel";

describe("smartRenderDetail", () => {
  it("is empty when smart render did not plan the job", () => {
    expect(smartRenderDetail(undefined)).toBe("");
  });

  it("is the summary alone when everything was copied or no reason is known", () => {
    expect(smartRenderDetail({ copiedPercent: 100, summary: "Smart render: 100% copied", reasons: ["x: effects"] })).toBe("Smart render: 100% copied");
    expect(smartRenderDetail({ copiedPercent: 62, summary: "Smart render: 62% copied" })).toBe("Smart render: 62% copied");
  });

  it("says why less than everything was copied, e.g. the native encoder falling back to a full re-encode", () => {
    expect(
      smartRenderDetail({
        copiedPercent: 0,
        summary: "Smart render: 0% copied",
        engine: "native",
        reasons: ["source H.264 profile is not 8-bit 4:2:0 (the encoder cannot match its parameters)"],
      }),
    ).toBe("Smart render: 0% copied (source H.264 profile is not 8-bit 4:2:0 (the encoder cannot match its parameters))");
    expect(smartRenderDetail({ copiedPercent: 66, summary: "Smart render: 66% copied", reasons: ["a.mp4: effects", "b.mp4: speed"] })).toBe(
      "Smart render: 66% copied (a.mp4: effects +1 more)",
    );
  });
});
