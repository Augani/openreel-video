import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectSerializer, activateSequence, createSequence, duplicateSequence, type Project, type SequenceEditResult } from "@openreel/core";

/**
 * Wave 8 schema composition. Every new optional field (proxy refs + ingest preset, multicam sources
 * and clip tags, graphic instances, bus/track repair racks) lives in ONE project at the same time:
 * it must survive an import/export cycle, switching into a nest and back, duplicating a sequence,
 * and a project without any of them must not gain them.
 */

const FIXTURES = join(__dirname, "fixtures", "compat");
const serializer = new ProjectSerializer({} as never);
const read = (wave: string): string => readFileSync(join(FIXTURES, `${wave}.openreel.json`), "utf8");

/** The edited project of a sequence edit that must have succeeded. */
function edited(result: SequenceEditResult): Project {
  if (!result.ok) throw new Error(`sequence edit failed: ${JSON.stringify(result)}`);
  return result.project;
}

type Loose = { project: Record<string, any> };

function composed(): string {
  const file = JSON.parse(read("w8")) as Loose;
  const project = file.project;
  project.mediaLibrary.ingestPreset = "proxies";
  project.mediaLibrary.items[0].proxy = {
    storage: "idb", path: `proxy:${project.mediaLibrary.items[0].id}`, width: 320, height: 180, codec: "avc1", frameRate: 30,
    duration: 6, fileSize: 1234, status: "ready", preset: "low", source: "generated", createdAt: 1,
  };
  const ids = project.mediaLibrary.items.map((m: any) => m.id as string);
  project.multicamSources = [
    {
      id: "mcsrc_w8", name: "Take", syncMethod: "manual", audio: { mode: "follow" }, createdAt: 1,
      angles: [
        { id: "a1", name: "A", mediaId: ids[0], offset: 0, duration: 6, color: "#ef4444" },
        { id: "a2", name: "B", mediaId: ids[1], offset: 0.5, duration: 6, color: "#22c55e" },
      ],
    },
  ];
  const tracks = project.timeline.tracks as any[];
  const main = tracks.find((t) => t.name === "Main");
  const loose = main.clips.find((c: any) => !c.metadata?.nest);
  if (loose) loose.metadata = { ...(loose.metadata ?? {}), multicam: { sourceId: "mcsrc_w8", angleId: "a1" } };
  project.timeline.audioBuses = [
    {
      id: "bus-dlg", name: "Dialogue", muted: false, solo: false,
      rack: { effects: [{ id: "fx-hum", type: "deHum", params: { frequency: 60, harmonics: 4, q: 30, depth: 1 }, bypassed: false }] },
    },
  ];
  const music = tracks.find((t) => t.name === "Music");
  music.output = "bus-dlg";
  music.audioRack = { effects: [{ id: "fx-click", type: "deClick", params: { sensitivity: 0.5, maxWidth: 24 }, bypassed: false }] };
  return JSON.stringify(file);
}

/** The new optional data of one project, reduced to comparable JSON. */
function w8Surface(project: Project) {
  const main = project.timeline.tracks.find((t) => t.name === "Music")!;
  return JSON.parse(
    JSON.stringify({
      ingestPreset: project.mediaLibrary.ingestPreset,
      proxy: project.mediaLibrary.items[0].proxy,
      multicamSources: project.multicamSources,
      taggedClips: project.timeline.tracks.flatMap((t) => t.clips).filter((c) => (c.metadata as any)?.multicam).map((c) => c.metadata),
      graphicInstances: project.graphicInstances,
      buses: project.timeline.audioBuses,
      musicRack: main.audioRack,
      musicOutput: main.output,
    }),
  );
}

describe("all wave 8 optional fields together", () => {
  const json = composed();

  it("the composed project validates and imports with every field", () => {
    expect(serializer.validateProjectJson(json).valid).toBe(true);
    const surface = w8Surface(serializer.importFromJson(json));
    expect(surface.ingestPreset).toBe("proxies");
    expect(surface.proxy).toMatchObject({ storage: "idb", status: "ready", preset: "low" });
    expect(surface.multicamSources).toHaveLength(1);
    expect(surface.taggedClips.length).toBeGreaterThan(0);
    expect(surface.graphicInstances).toHaveLength(1);
    expect(surface.buses[0].rack.effects[0].type).toBe("deHum");
    expect(surface.musicRack.effects[0].type).toBe("deClick");
    expect(surface.musicOutput).toBe("bus-dlg");
  });

  it("survives export and re-import, and the second cycle is stable", () => {
    const first = serializer.importFromJson(json);
    const again = serializer.importFromJson(serializer.exportToJson(first));
    expect(w8Surface(again)).toEqual(w8Surface(first));
    expect(JSON.parse(serializer.exportToJson(again))).toEqual(JSON.parse(serializer.exportToJson(serializer.importFromJson(serializer.exportToJson(again)))));
  });

  it("survives opening a nest, returning to the main sequence and duplicating a sequence", () => {
    const loaded = serializer.importFromJson(json);
    const surface = w8Surface(loaded);
    expect(loaded.sequences!.length).toBeGreaterThanOrEqual(2);
    const mainId = loaded.activeSequenceId!;
    const nestId = loaded.sequences!.find((s) => s.id !== mainId)!.id;

    // Project-level data does not belong to a sequence: it is untouched inside the nest.
    const nested = edited(activateSequence(loaded, nestId));
    expect(nested.multicamSources).toEqual(loaded.multicamSources);
    expect(nested.graphicInstances).toEqual(loaded.graphicInstances);
    expect(nested.mediaLibrary).toEqual(loaded.mediaLibrary);

    const back = edited(activateSequence(nested, mainId));
    expect(w8Surface(back)).toEqual(surface);

    const copy = { project: edited(duplicateSequence(back, mainId)) };
    expect(copy.project.multicamSources).toEqual(loaded.multicamSources);
    expect(copy.project.mediaLibrary.items[0].proxy).toEqual(loaded.mediaLibrary.items[0].proxy);
    // The duplicate's copy of the graphic is detached from the original (editing one never edits the other).
    const originals = new Set((loaded.graphicInstances ?? []).map((g) => g.id));
    const members = [...(copy.project.textClips ?? []), ...(copy.project.shapeClips ?? [])].filter((c) => (c.metadata as any)?.graphicInstanceId);
    expect(members.filter((c) => !originals.has((c.metadata as any).graphicInstanceId)).length).toBe(0);

    const created = edited(createSequence(copy.project, { name: "Another" }));
    const roundTrip = serializer.importFromJson(serializer.exportToJson(created));
    expect(roundTrip.multicamSources).toEqual(loaded.multicamSources);
    expect(roundTrip.graphicInstances).toEqual(loaded.graphicInstances);
    expect(roundTrip.mediaLibrary.ingestPreset).toBe("proxies");
  });

  it("older files (w4-w6) do not gain any wave 8 field on re-save", () => {
    for (const wave of ["w4", "w5", "w6"]) {
      const saved = serializer.exportToJson(serializer.importFromJson(read(wave)));
      for (const key of ["multicamSources", "graphicInstances", "ingestPreset", "\"proxy\""]) expect(saved, `${wave} ${key}`).not.toContain(key);
    }
  });
});
