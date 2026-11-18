import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectSerializer, createRackEffect, type Effect, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Audio repair adds new effect types (DeHum, DeClick, DeClip, DeEss, DeReverb, Gate) to clip audio
 * effects and to track / bus / master racks, and stems jobs to the export queue. Nothing in the
 * project schema is required by them, so:
 *  - the w4/w5/w6 files load unchanged and re-save without any repair data;
 *  - a project that uses the new effects (fixtures/compat/w8-audio-repair.openreel.json, written by this
 *    tree from the w6 fixture) loads, keeps every parameter through a re-save, opens in the store and edits as
 *    one undo step per edit.
 */

const FIXTURES = join(__dirname, "fixtures", "compat");
const serializer = new ProjectSerializer({} as never);
const read = (name: string): string => readFileSync(join(FIXTURES, `${name}.openreel.json`), "utf8");

const REPAIR_TYPES = ["deHum", "deClick", "deClip", "deEss", "deReverb", "gate"];

function buildRepairProject(): Project {
  const base = serializer.importFromJson(read("w6"));
  const music = base.timeline.tracks.find((track) => track.name === "Music")!;
  const clipEffects: Effect[] = [
    { id: "fx-hum", type: "deHum", enabled: true, params: { frequency: 50, harmonics: 5, q: 30, depth: 1 } },
    { id: "fx-click", type: "deClick", enabled: true, params: { sensitivity: 0.6, maxWidth: 24 } },
    { id: "fx-ess", type: "deEss", enabled: false, params: { frequency: 7000, bandwidthQ: 1.5, threshold: -28, ratio: 6, attack: 0.001, release: 0.05, listen: 0 } },
  ];
  const tracks = base.timeline.tracks.map((track) =>
    track.id === music.id
      ? {
          ...track,
          clips: track.clips.map((clip, index) => (index === 0 ? { ...clip, audioEffects: [...(clip.audioEffects ?? []), ...clipEffects] } : clip)),
          audioRack: { effects: [createRackEffect("gate", { id: "rack-gate", params: { threshold: -45, range: -24 } }), createRackEffect("deClip", { id: "rack-clip" })] },
        }
      : track,
  );
  return {
    ...base,
    name: "Compat w8 audio repair",
    timeline: {
      ...base.timeline,
      tracks,
      audioBuses: [{ id: "bus-dialogue", name: "Dialogue", role: "dialogue", volume: 1, rack: { effects: [createRackEffect("deEss", { id: "bus-ess" })] } } as never],
      masterAudioRack: { effects: [createRackEffect("deReverb", { id: "master-reverb", params: { amount: 0.4, rt60: 0.7 } })] },
    },
  };
}

describe("audio repair project compatibility", () => {
  it.skipIf(!process.env.OPENREEL_AUDIO_REPAIR_FIXTURE_OUT)("writes the fixture (regeneration helper)", () => {
    writeFileSync(process.env.OPENREEL_AUDIO_REPAIR_FIXTURE_OUT!, serializer.exportToJson(buildRepairProject()));
  });

  it("w4, w5 and w6 files load and re-save without any repair effect appearing", () => {
    for (const wave of ["w4", "w5", "w6"]) {
      const resaved = serializer.exportToJson(serializer.importFromJson(read(wave)));
      for (const type of REPAIR_TYPES) expect(resaved, `${wave} must not gain ${type}`).not.toContain(`"${type}"`);
    }
  });

  describe("project that uses repair effects", () => {
    const json = existsSync(join(FIXTURES, "w8-audio-repair.openreel.json")) ? read("w8-audio-repair") : "{}"; // absent only while the generator test runs

    it("validates, imports and keeps every effect and rack parameter", () => {
      expect(serializer.validateProjectJson(json).valid).toBe(true);
      const project = serializer.importFromJson(json);
      const music = project.timeline.tracks.find((track) => track.name === "Music")!;
      const effects = music.clips[0].audioEffects.filter((effect) => REPAIR_TYPES.includes(effect.type));
      expect(effects.map((effect) => [effect.id, effect.type, effect.enabled])).toEqual([
        ["fx-hum", "deHum", true],
        ["fx-click", "deClick", true],
        ["fx-ess", "deEss", false],
      ]);
      expect(effects[0].params).toMatchObject({ frequency: 50, harmonics: 5, q: 30, depth: 1 });
      expect(music.audioRack?.effects.map((fx) => [fx.type, fx.params.threshold])).toEqual([["gate", -45], ["deClip", -0.5]]);
      expect(project.timeline.audioBuses?.[0].rack?.effects[0]).toMatchObject({ type: "deEss", params: { frequency: 6500, threshold: -30 } });
      expect(project.timeline.masterAudioRack?.effects[0]).toMatchObject({ type: "deReverb", params: { amount: 0.4, rt60: 0.7 } });
    });

    it("re-saves with every repair effect and rack untouched, and a second re-save changes nothing", () => {
      const original = JSON.parse(json) as { project: Project };
      const first = JSON.parse(serializer.exportToJson(serializer.importFromJson(json))) as { project: Project };
      const slice = (file: { project: Project }) => ({
        effects: file.project.timeline.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.audioEffects)).filter((fx) => REPAIR_TYPES.includes(fx.type)),
        racks: file.project.timeline.tracks.map((track) => track.audioRack ?? null),
        buses: (file.project.timeline.audioBuses ?? []).map((bus) => bus.rack ?? null),
        master: file.project.timeline.masterAudioRack ?? null,
      });
      expect(slice(first)).toEqual(slice(original));
      expect(JSON.parse(serializer.exportToJson(serializer.importFromJson(JSON.stringify(first))))).toEqual(first);
    });

    it("opens in the store; toggling a repair effect and editing its rack are one undo step each", async () => {
      useProjectStore.getState().loadProject(serializer.importFromJson(json));
      const history = useProjectStore.getState().actionHistory;
      const music = useProjectStore.getState().project.timeline.tracks.find((track) => track.name === "Music")!;
      const clip = music.clips[0];
      const before = history.getUndoStackSize();
      await useProjectStore.getState().toggleAudioEffect(clip.id, "fx-ess", true);
      expect(history.getUndoStackSize()).toBe(before + 1);
      expect(useProjectStore.getState().getClip(clip.id)?.audioEffects.find((e) => e.id === "fx-ess")?.enabled).toBe(true);
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().getClip(clip.id)?.audioEffects.find((e) => e.id === "fx-ess")?.enabled).toBe(false);
      const rackBefore = history.getUndoStackSize();
      const rack = useProjectStore.getState().project.timeline.tracks.find((track) => track.id === music.id)!.audioRack!;
      await useProjectStore.getState().setAudioRack(music.id, { ...rack, effects: rack.effects.map((fx) => (fx.id === "rack-gate" ? { ...fx, bypassed: true } : fx)) });
      expect(history.getUndoStackSize()).toBe(rackBefore + 1);
    });
  });
});
