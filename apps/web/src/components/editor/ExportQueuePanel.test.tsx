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

  it("adds how many seconds of audio were copied from the sources when the report has them", () => {
    expect(
      smartRenderDetail({ copiedPercent: 100, summary: "Smart render: 100% copied", copiedSeconds: 8, encodedSeconds: 0, audioCopiedSeconds: 8, audioEncodedSeconds: 0, audioMode: "whole" }),
    ).toBe("Smart render: 100% copied (8.0 s copied, 0.0 s re-encoded); audio 8.0 s copied, 0.0 s encoded");
  });

  it("says how many seconds were copied and re-encoded when the report has them", () => {
    expect(smartRenderDetail({ copiedPercent: 83, summary: "Smart render: 83% copied", copiedSeconds: 99.6, encodedSeconds: 20.4 })).toBe(
      "Smart render: 83% copied (99.6 s copied, 20.4 s re-encoded)",
    );
    expect(smartRenderDetail({ copiedPercent: 83, summary: "Smart render: 83% copied", copiedSeconds: 99.6, encodedSeconds: 20.4, reasons: ["a.mp4: effects"] })).toBe(
      "Smart render: 83% copied (99.6 s copied, 20.4 s re-encoded) (a.mp4: effects)",
    );
  });
});
