import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { duplicateSequence, ensureSequences, nestClips } from "../timeline/sequences";
import {
  getBuiltInGraphicTemplate,
  graphicMemberClipIds,
  insertGraphicTemplate,
  reconcileGraphicInstances,
  removeGraphic,
  setGraphicParameter,
} from "./index";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const mediaClip = (id: string, startTime: number, duration: number): Clip => ({
  id, mediaId: "m1", trackId: "v1", startTime, duration, inPoint: 0, outPoint: duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track: Track = {
  id: "v1", type: "video", name: "V1", mode: "standard", clips: [mediaClip("c1", 0, 20)],
  transitions: [], locked: false, hidden: false, muted: false, solo: false,
};
const base = {
  id: "p", name: "P", createdAt: 1, modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [track], subtitles: [], markers: [], duration: 20 },
} as unknown as Project;

function make() {
  const template = getBuiltInGraphicTemplate("builtin-lt-classic-bar");
  if (!template) throw new Error("missing built-in");
  const result = insertGraphicTemplate(base, template, { startTime: 2 });
  if (!result.ok) throw new Error(result.message);
  return { project: result.project, id: result.instanceId as string };
}

const overlayCount = (project: Project): number =>
  (project.textClips?.length ?? 0) + (project.shapeClips?.length ?? 0) + (project.svgClips?.length ?? 0);

describe("graphics with sequences", () => {
  it("overlay copies made by duplicating a sequence are not owned by the original graphic", () => {
    const { project, id } = make();
    const sequenced = ensureSequences(project);
    const sequenceId = sequenced.activeSequenceId as string;
    const duplicated = duplicateSequence(sequenced, sequenceId);
    if (!duplicated.ok) throw new Error(duplicated.message);
    const before = overlayCount(duplicated.project);
    expect(before).toBe(overlayCount(project) * 2);
    const parameter = duplicated.project.graphicInstances?.[0]?.template.parameters[0];
    if (!parameter) throw new Error("no parameter");
    const edited = setGraphicParameter(duplicated.project, id, parameter.id, "Edited");
    if (!edited.ok) throw new Error(edited.message);
    expect(overlayCount(edited.project)).toBe(before);
    const removed = removeGraphic(duplicated.project, id);
    if (!removed.ok) throw new Error(removed.message);
    expect(overlayCount(removed.project)).toBe(before / 2);
  });

  it("nesting a graphic by its anchor clip takes the whole graphic along", () => {
    const { project, id } = make();
    const ids = [...graphicMemberClipIds(project)];
    expect(ids.length).toBeGreaterThan(1);
    const nested = nestClips(project, ["c1", ids[0]]);
    if (!nested.ok) throw new Error(nested.message);
    const reconciled = reconcileGraphicInstances(nested.project);
    const members = [...(reconciled.textClips ?? []), ...(reconciled.shapeClips ?? []), ...(reconciled.svgClips ?? [])];
    expect(members).toHaveLength(ids.length);
    expect(new Set(members.map((clip) => clip.trackId)).size).toBe(1);
    const original = project.graphicInstances?.find((item) => item.id === id)?.trackId;
    expect(members[0].trackId).not.toBe(original);
    expect(reconciled.graphicInstances?.find((item) => item.id === id)?.trackId).toBe(members[0].trackId);
  });
});
