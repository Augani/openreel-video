import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import type { Marker } from "../types/timeline";
import { buildProject } from "./__fixtures__/project";
import { exportTimeline } from "./index";

const marker = (id: string, time: number, label: string, extra: Partial<Marker> = {}): Marker => ({
  id,
  time,
  label,
  color: "#ef4444",
  ...extra,
});

/** Clip A (media m-interview, source 30 frames in) carries one clip marker; its media one master marker. */
function withMarkers(fps: number): Project {
  const project = buildProject(fps);
  const tracks = project.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => (c.id === "A" ? { ...c, markers: [marker("c1", c.inPoint + 0.5, "Clip note")] } : c)),
  }));
  const items = project.mediaLibrary.items.map((i) =>
    i.id === "m-interview" ? { ...i, markers: [marker("m1", 1.0, "Master note", { kind: "chapter" })] } : i,
  );
  return { ...project, timeline: { ...project.timeline, tracks }, mediaLibrary: { ...project.mediaLibrary, items } } as Project;
}

const text = (project: Project, format: "otio" | "xmeml", options = {}) =>
  exportTimeline(project, format, options).files.map((f) => f.content).join("\n");

describe("clip and master-clip markers in interchange", () => {
  it("OTIO writes master + clip markers on the clip in source time, not the sequence", () => {
    const doc = JSON.parse(text(withMarkers(25), "otio")) as { tracks: { children: { children: { name?: string; markers?: { name: string; marked_range: { start_time: { value: number; rate: number } }; metadata: { openreel?: { scope?: string } } }[] }[] }[] } };
    const clips = doc.tracks.children.flatMap((t) => t.children);
    const withM = clips.filter((c) => (c.markers ?? []).length > 0);
    const all = withM.flatMap((c) => c.markers!);
    const clipNote = all.find((m) => m.name === "Clip note")!;
    const a = withMarkers(25).timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === "A")!;
    expect(clipNote.marked_range.start_time.value / clipNote.marked_range.start_time.rate).toBeCloseTo(a.inPoint + 0.5, 1);
    expect(clipNote.metadata.openreel?.scope).toBe("clip");
    // The master marker (1.0s) is outside clip A's source range but inside clip C's, so it shows on C (and its linked audio) only.
    expect(all.filter((m) => m.name === "Master note").length).toBeGreaterThan(0);
    expect(all.filter((m) => m.name === "Clip note").length).toBeGreaterThan(0);
    for (const c of withM) {
      if (c.markers!.some((m) => m.name === "Clip note")) expect(c.markers!.some((m) => m.name === "Master note")).toBe(false);
    }
  });

  it("XMEML keeps writing them as clipitem markers", () => {
    const xml = text(withMarkers(25), "xmeml");
    expect(xml).toContain("<name>Clip note</name>");
    expect(xml).toContain("<name>Master note</name>");
  });

  it("includeMarkers: false drops clip markers from both formats", () => {
    expect(text(withMarkers(25), "otio", { includeMarkers: false })).not.toContain("Clip note");
    expect(text(withMarkers(25), "xmeml", { includeMarkers: false })).not.toContain("Clip note");
  });
});
