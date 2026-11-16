import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectSerializer } from "@openreel/core";

/**
 * `project.multicamSources` is optional. Projects from w4..w6 must load with it
 * absent and re-save without gaining it; a project that has it must keep it
 * (and its tagged clips) through a save/load cycle.
 */
const serializer = new ProjectSerializer({} as never);
const read = (wave: string): string => readFileSync(join(__dirname, "fixtures", "compat", `${wave}.openreel.json`), "utf8");

describe.each(["w4", "w5", "w6"])("%s project and multicam sources", (wave) => {
  it("loads without multicam sources and does not invent any on re-save", () => {
    const project = serializer.importFromJson(read(wave));
    expect(project.multicamSources).toBeUndefined();
    const resaved = JSON.parse(serializer.exportToJson(project)) as { project: Record<string, unknown> };
    expect("multicamSources" in resaved.project).toBe(false);
  });

  it("keeps multicam sources and clip tags through save and load", () => {
    const file = JSON.parse(read(wave)) as { project: { multicamSources?: unknown; timeline: { tracks: Array<{ clips: Array<{ metadata?: unknown }> }> } } };
    const source = {
      id: "mcsrc_1",
      name: "Take",
      syncMethod: "audio",
      audio: { mode: "follow" },
      createdAt: 1,
      angles: [
        { id: "a1", name: "A", mediaId: "media-scenes", offset: 0, duration: 6, color: "#ef4444" },
        { id: "a2", name: "B", mediaId: "media-tone", offset: 0.5, duration: 6, color: "#22c55e" },
      ],
    };
    file.project.multicamSources = [source];
    const clip = file.project.timeline.tracks.flatMap((t) => t.clips)[0];
    clip.metadata = { multicam: { sourceId: "mcsrc_1", angleId: "a1" } };
    const loaded = serializer.importFromJson(JSON.stringify(file));
    expect(loaded.multicamSources).toEqual([source]);
    const again = serializer.importFromJson(serializer.exportToJson(loaded));
    expect(again.multicamSources).toEqual([source]);
    expect(again.timeline.tracks.flatMap((t) => t.clips).some((c) => (c.metadata as { multicam?: unknown } | undefined)?.multicam)).toBe(true);
  });
});
