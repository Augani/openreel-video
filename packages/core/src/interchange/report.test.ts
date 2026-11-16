import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { buildProject } from "./__fixtures__/project";
import { exportTimeline, type InterchangeFormat } from "./index";

/** The fixture plus one clip carrying many features that no interchange format holds. */
function richProject(): Project {
  const base = buildProject(25);
  const tracks = base.timeline.tracks.map((t) => {
    if (t.id !== "t-main") return t;
    const clips = t.clips.map((c) =>
      c.id === "A"
        ? {
            ...c,
            effects: [{ id: "fx1", type: "blur", params: {}, enabled: true }],
            audioEffects: [{ id: "fx2", type: "reverb", params: {}, enabled: true }],
            transform: { ...c.transform, position: { x: 40, y: 0 }, rotation: 12 },
            fade: { fadeIn: 0.5, fadeOut: 0 },
            keyframes: [{ id: "k1", time: 0, property: "opacity", value: 1, easing: "linear" }] as never,
            speedKeyframes: [{ id: "s1", time: 0, speed: 1, easing: "linear" }, { id: "s2", time: 1, speed: 2, easing: "linear" }] as never,
          }
        : c,
    );
    return { ...t, clips };
  });
  return {
    ...base,
    timeline: { ...base.timeline, tracks },
    textClips: [
      {
        id: "txt1",
        trackId: "t-text",
        startTime: 0,
        duration: 2,
        text: "Hello\nWorld",
        style: {} as never,
        transform: {} as never,
        keyframes: [],
      },
    ],
  };
}

const featureOf = (report: ReturnType<typeof exportTimeline>["report"]) => report.items.map((i) => i.feature);

describe("interchange export report", () => {
  it("lists dropped and approximated features per clip instead of dropping silently", () => {
    const result = exportTimeline(richProject(), "xmeml");
    const clipA = result.report.items.filter((i) => i.clipId === "A");
    expect(clipA.map((i) => i.feature).sort()).toEqual(
      ["Audio effects", "Clip fades", "Keyframes", "Position / scale / rotation", "Speed ramp", "Video effects"].sort(),
    );
    expect(clipA.find((i) => i.feature === "Speed ramp")?.severity).toBe("approximated");
    expect(clipA.find((i) => i.feature === "Video effects")).toMatchObject({
      severity: "dropped",
      clipName: "interview.mp4",
      trackName: "Main",
    });
    expect(clipA.find((i) => i.feature === "Video effects")?.detail).toContain("blur");
    const text = result.report.items.find((i) => i.feature === "Text clip");
    expect(text).toMatchObject({ severity: "dropped", clipName: "Hello World" });
    expect(result.report.dropped).toBe(result.report.items.filter((i) => i.severity === "dropped").length);
    expect(result.report.byFeature.find((r) => r.feature === "Video effects")?.count).toBe(1);
  });

  it("reports nested sequences, captions and non-timeline items", () => {
    const p = richProject();
    const withNested: Project = {
      ...p,
      compoundClips: [{ id: "cc1", name: "Intro compound" } as never],
      nestedInstances: [
        { id: "ni1", compoundClipId: "cc1", trackId: "t-main", startTime: 0, duration: 1, inPoint: 0, outPoint: 1, transform: {} as never, volume: 1 },
      ],
      timeline: { ...p.timeline, subtitles: [{ id: "s", text: "x", startTime: 0, endTime: 1 } as never] },
    };
    const items = exportTimeline(withNested, "fcpxml").report.items;
    expect(items.find((i) => i.feature === "Nested sequence")).toMatchObject({ clipName: "Intro compound", trackName: "Main" });
    expect(items.find((i) => i.feature === "Captions")?.severity).toBe("dropped");
  });

  it("is quiet for a plain timeline in the formats that can carry it", () => {
    for (const format of ["xmeml", "fcpxml", "otio"] as InterchangeFormat[]) {
      const features = featureOf(exportTimeline(buildProject(25), format).report);
      expect(features.filter((f) => !["Opacity / level", "Transition"].includes(f))).toEqual([]);
    }
  });

  it("adds format-specific losses for EDL: audio, opacity, level and markers", () => {
    const items = exportTimeline(buildProject(25), "edl").report.items;
    expect(items.filter((i) => i.feature === "Audio track").map((i) => i.trackName)).toEqual(["A1"]);
    expect(items.filter((i) => i.feature === "Marker")).toHaveLength(2);
    expect(items.some((i) => i.feature === "Opacity" && i.clipId === "D")).toBe(true);
    expect(items.some((i) => i.feature === "Clip level" && i.clipId === "C")).toBe(true);
  });

  it("FCPXML: a transition on a connected lane is dropped, other kinds approximated", () => {
    const base = buildProject(25);
    const tracks = base.timeline.tracks.map((t) =>
      t.id === "t-main"
        ? { ...t, transitions: t.transitions.map((x) => ({ ...x, type: "wipe" as const })) }
        : t,
    );
    const items = exportTimeline({ ...base, timeline: { ...base.timeline, tracks } }, "fcpxml").report.items;
    expect(items.find((i) => i.feature === "Transition")).toMatchObject({ severity: "approximated", trackName: "Main" });
  });

  it("a clip pointing at missing media is reported as dropped", () => {
    const base = buildProject(25);
    const tracks = base.timeline.tracks.map((t) =>
      t.id === "t-over" ? { ...t, clips: t.clips.map((c) => ({ ...c, mediaId: "gone" })) } : t,
    );
    const r = exportTimeline({ ...base, timeline: { ...base.timeline, tracks } }, "xmeml").report;
    expect(r.items.find((i) => i.feature === "Missing media")).toMatchObject({ severity: "dropped", clipId: "D", trackName: "V2" });
  });
});
