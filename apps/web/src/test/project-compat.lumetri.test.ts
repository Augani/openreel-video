import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TONE, ProjectSerializer, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Basic Correction and Vignette add only OPTIONAL fields to a clip's `colorGrading` (`tone`, `vignette`)
 * plus keyframes on the `colorGrade.tone.*` / `colorGrade.vignette.*` properties. So:
 *  - the w4..w9 files load and re-save without any of them appearing;
 *  - a project that uses them (fixtures/compat/w12-lumetri.openreel.json, written by this tree from the w9
 *    fixture) loads, keeps every field through a re-save, opens in the store, and an edit is one undo step.
 */

const FIXTURES = join(__dirname, "fixtures", "compat");
const serializer = new ProjectSerializer({} as never);
const read = (name: string): string => readFileSync(join(FIXTURES, `${name}.openreel.json`), "utf8");

const TONE = { ...DEFAULT_TONE, shadows: 0.35, highlights: -0.2, blacks: -0.1 };
const VIGNETTE = { amount: -0.45, midpoint: 0.55, roundness: 0.2, feather: 0.6 };

function buildLumetriProject(): Project {
  const base = serializer.importFromJson(read("w9-desktop-ingest"));
  let graded = false;
  return {
    ...base,
    name: "Compat w12 lumetri",
    timeline: {
      ...base.timeline,
      tracks: base.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (graded || track.type !== "video") return clip;
          graded = true;
          return {
            ...clip,
            colorGrading: { ...clip.colorGrading, temperature: 6, tone: TONE, vignette: VIGNETTE },
            keyframes: [
              ...(clip.keyframes ?? []),
              { id: "k-shadows-0", time: 0, property: "colorGrade.tone.shadows", value: 0, easing: "linear" as const },
              { id: "k-shadows-1", time: 1, property: "colorGrade.tone.shadows", value: 0.5, easing: "linear" as const },
            ],
          };
        }),
      })),
    },
  };
}

const gradedClip = (project: Project) =>
  project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.colorGrading?.tone);

describe("Basic Correction project compatibility", () => {
  it.skipIf(!process.env.OPENREEL_LUMETRI_FIXTURE_OUT)("writes the fixture (regeneration helper)", () => {
    writeFileSync(process.env.OPENREEL_LUMETRI_FIXTURE_OUT!, serializer.exportToJson(buildLumetriProject()));
  });

  it("w4..w9 files load and re-save without tone, vignette or colour keyframes appearing", () => {
    for (const wave of ["w4", "w5", "w6", "w8", "w8-audio-repair", "w9-desktop-ingest"]) {
      const resaved = serializer.exportToJson(serializer.importFromJson(read(wave)));
      expect(resaved, `${wave} must not gain tone`).not.toContain('"tone"');
      expect(resaved, `${wave} must not gain vignette`).not.toContain('"vignette"');
      expect(resaved, `${wave} must not gain colorGrade keyframes`).not.toContain("colorGrade.");
    }
  });

  describe("project that uses Basic Correction", () => {
    const json = existsSync(join(FIXTURES, "w12-lumetri.openreel.json")) ? read("w12-lumetri") : "{}"; // absent only while the generator test runs

    it("validates, imports and keeps tone, vignette and keyframes", () => {
      expect(serializer.validateProjectJson(json).valid).toBe(true);
      const clip = gradedClip(serializer.importFromJson(json))!;
      expect(clip.colorGrading).toMatchObject({ temperature: 6, tone: TONE, vignette: VIGNETTE });
      expect(clip.keyframes.filter((key) => key.property === "colorGrade.tone.shadows")).toHaveLength(2);
    });

    it("re-saves with every field untouched, and a second re-save changes nothing", () => {
      const first = JSON.parse(serializer.exportToJson(serializer.importFromJson(json))) as { project: Project };
      const original = JSON.parse(json) as { project: Project };
      const slice = (file: { project: Project }) => {
        const clip = gradedClip(file.project)!;
        return { grade: clip.colorGrading, keys: clip.keyframes };
      };
      expect(slice(first)).toEqual(slice(original));
      expect(JSON.parse(serializer.exportToJson(serializer.importFromJson(JSON.stringify(first))))).toEqual(first);
    });

    it("opens in the store; editing the tone is one undo step that restores the saved grade", async () => {
      useProjectStore.getState().loadProject(serializer.importFromJson(json));
      const clip = gradedClip(useProjectStore.getState().project)!;
      const history = useProjectStore.getState().actionHistory;
      const before = history.getUndoStackSize();
      expect(await useProjectStore.getState().updateColorGrading(clip.id, { tone: { ...TONE, whites: 0.25 } })).toBe(true);
      expect(history.getUndoStackSize()).toBe(before + 1);
      expect(useProjectStore.getState().getClip(clip.id)?.colorGrading?.tone?.whites).toBe(0.25);
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().getClip(clip.id)?.colorGrading?.tone).toEqual(TONE);
    });
  });
});
