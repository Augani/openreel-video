import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { clearRemovalAnalyses, registerRemovalAnalysis, setRemovalAnalysisLoader } from "@openreel/core/video/content-aware-fill/registry";
import { clipsMissingRemovalAnalysis } from "./content-aware-fill";

const enabled = { enabled: true, maskId: "m", analysisKey: "k", dilate: 2, feather: 2 };

describe("clipsMissingRemovalAnalysis", () => {
  it("lists only enabled clips whose analysis is in neither memory nor the cache (cleared IndexedDB)", async () => {
    clearRemovalAnalyses();
    setRemovalAnalysisLoader(async () => null);
    registerRemovalAnalysis("have", { key: "k", width: 1, height: 1, fps: 30, frames: [] });
    const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, objectRemoval: { ...enabled, ...extra } });
    const project = { timeline: { tracks: [{ clips: [clip("have"), clip("copy"), clip("gone", { analysisKey: "missing" }), clip("off", { enabled: false })] }] } } as unknown as Pick<Project, "timeline">;
    expect((await clipsMissingRemovalAnalysis(project)).map((c) => c.id)).toEqual(["gone"]);
  });
});
