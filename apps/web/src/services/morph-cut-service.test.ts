import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { projectHasMorphCut } from "./morph-cut-hook";
import { collectMorphCutTargets } from "./morph-cut-service";

const clip = (id: string, mediaId: string) => ({ id, mediaId, trackId: "v1", startTime: 0, duration: 2, inPoint: 0, outPoint: 2 });
const media = (id: string, withBlob = true) => ({ id, name: id, type: "video", blob: withBlob ? new Blob(["x"]) : null });

function project(transitions: unknown[], items = [media("m1"), media("m2")]): Project {
  return {
    settings: { width: 1280, height: 720 },
    mediaLibrary: { items },
    timeline: { tracks: [{ id: "v1", clips: [clip("a", "m1"), clip("b", "m2")], transitions }] },
  } as unknown as Project;
}

describe("Morph Cut background analysis scan", () => {
  it("only wakes the lazy service for projects that have a Morph Cut", () => {
    expect(projectHasMorphCut(project([]))).toBe(false);
    expect(projectHasMorphCut(project([{ id: "t", type: "crossfade", clipAId: "a", clipBId: "b" }]))).toBe(false);
    expect(projectHasMorphCut(project([{ id: "t", type: "morphCut", clipAId: "a", clipBId: "b" }]))).toBe(true);
  });

  it("targets every Morph Cut with both clips and their media, and skips the rest", () => {
    const morph = { id: "t1", type: "morphCut", clipAId: "a", clipBId: "b", duration: 0.5, params: {} };
    const other = { id: "t2", type: "crossfade", clipAId: "a", clipBId: "b", duration: 0.5, params: {} };
    const edge = { id: "t3", type: "morphCut", clipAId: "a", duration: 0.5, params: {}, edge: "out" };
    const { targets, ids } = collectMorphCutTargets(project([morph, other, edge]));
    expect(targets.map((t) => t.transition.id)).toEqual(["t1"]);
    expect(targets[0]!.clipA.id).toBe("a");
    expect(targets[0]!.clipB.id).toBe("b");
    expect([...ids].sort()).toEqual(["t1", "t3"]);
    // media that is missing or has no bytes yet cannot be analysed
    expect(collectMorphCutTargets(project([morph], [media("m1"), media("m2", false)])).targets).toEqual([]);
    expect(collectMorphCutTargets(project([morph], [media("m1")])).targets).toEqual([]);
  });
});
