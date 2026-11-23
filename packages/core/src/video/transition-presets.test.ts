import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import { ProjectSerializer } from "../storage/project-serializer";
import {
  buildTransitionAtCut,
  createTransitionPreset,
  defaultFromPreset,
  resolveDefaultTransition,
  FALLBACK_DEFAULT_TRANSITION,
} from "./transition-presets";
import { getDefaultTransitionParams } from "./transition-engine";

const clip = (id: string, startTime: number, duration: number): Clip =>
  ({
    id,
    mediaId: "m",
    trackId: "t1",
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    effects: [],
    audioEffects: [],
    keyframes: [],
    volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchorPoint: { x: 0.5, y: 0.5 } },
  }) as unknown as Clip;

function project(): Project {
  return {
    id: "p",
    name: "t",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 10,
      markers: [],
      subtitles: [],
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          transitions: [],
          clips: [clip("a", 0, 5), clip("b", 5, 5)],
        },
      ],
    },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `a-${Math.random()}`, timestamp: Date.now(), params }) as Action;

function preset(id: string, name: string, type = "irisBox", params: Record<string, unknown> = { feather: 0.2, borderWidth: 4, borderColor: "#ff0000" }) {
  const made = createTransitionPreset({ id, name, type, duration: 0.8, params: { ...getDefaultTransitionParams(type as "irisBox"), ...params } });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

describe("createTransitionPreset", () => {
  it("trims the name and clones the params", () => {
    const params = { feather: 0.3 };
    const made = createTransitionPreset({ id: "p", name: "  Red iris ", type: "irisBox", duration: 1, params });
    expect(made.ok && made.value.name).toBe("Red iris");
    params.feather = 0.9;
    expect(made.ok && made.value.params.feather).toBe(0.3);
  });

  it.each([
    ["", "irisBox", 1, "Give the preset a name"],
    ["x", "nope", 1, "Unknown transition type"],
    ["x", "irisBox", 0, "Duration"],
    ["x", "irisBox", 31, "Duration"],
  ])("rejects name=%j type=%s duration=%s", (name, type, duration, message) => {
    const made = createTransitionPreset({ id: "p", name, type, duration, params: {} });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error).toContain(message);
  });
});

describe("transitionPreset/setLibrary", () => {
  it("stores presets and the default, undoes and redoes them", async () => {
    const ex = new ActionExecutor();
    const p = project();
    const one = preset("p1", "Red iris");
    expect((await ex.execute(act("transitionPreset/setLibrary", { presets: [one], defaultTransition: defaultFromPreset(one) }), p)).success).toBe(true);
    expect(p.transitionPresets).toHaveLength(1);
    expect(resolveDefaultTransition(p).presetId).toBe("p1");

    const two = preset("p2", "Soft clock", "clockWipe", { feather: 0.5 });
    expect((await ex.execute(act("transitionPreset/setLibrary", { presets: [one, two] }), p)).success).toBe(true);
    expect(p.transitionPresets).toHaveLength(2);
    expect(resolveDefaultTransition(p).presetId).toBe("p1"); // omitted default is left alone

    await ex.undo(p);
    expect(p.transitionPresets).toHaveLength(1);
    await ex.undo(p);
    expect(p.transitionPresets ?? []).toHaveLength(0);
    expect(resolveDefaultTransition(p)).toEqual(FALLBACK_DEFAULT_TRANSITION);
    await ex.redo(p);
    expect(p.transitionPresets).toHaveLength(1);
    expect(p.defaultTransition?.type).toBe("irisBox");
  });

  it("clears the default with null and rejects invalid libraries", async () => {
    const ex = new ActionExecutor();
    const p = project();
    const one = preset("p1", "A");
    await ex.execute(act("transitionPreset/setLibrary", { presets: [one], defaultTransition: defaultFromPreset(one) }), p);
    expect((await ex.execute(act("transitionPreset/setLibrary", { defaultTransition: null }), p)).success).toBe(true);
    expect(p.defaultTransition).toBeUndefined();
    expect((await ex.execute(act("transitionPreset/setLibrary", { presets: [one, one] }), p)).success).toBe(false);
    expect((await ex.execute(act("transitionPreset/setLibrary", { presets: [{ ...one, type: "bogus" }] }), p)).success).toBe(false);
    expect((await ex.execute(act("transitionPreset/setLibrary", {}), p)).success).toBe(false);
    expect(p.transitionPresets).toHaveLength(1);
  });

  it("survives a project save and reload", async () => {
    const ex = new ActionExecutor();
    const p = project();
    const one = preset("p1", "Persisted");
    await ex.execute(act("transitionPreset/setLibrary", { presets: [one], defaultTransition: defaultFromPreset(one) }), p);
    const serializer = new ProjectSerializer({} as ConstructorParameters<typeof ProjectSerializer>[0]);
    const reloaded = serializer.importFromJson(serializer.exportToJson(p));
    expect(reloaded.transitionPresets?.[0]).toEqual(one);
    expect(reloaded.defaultTransition?.label).toBe("Persisted");
  });
});

describe("applying a preset", () => {
  it("builds a transition at a cut with the preset's parameters and clamps the duration", () => {
    const one = preset("p1", "Red iris");
    const built = buildTransitionAtCut(one, clip("a", 0, 5), clip("b", 5, 5), "t-1");
    expect(built).toMatchObject({ id: "t-1", clipAId: "a", clipBId: "b", type: "irisBox", duration: 0.8 });
    expect(built.params).toMatchObject({ feather: 0.2, borderWidth: 4, borderColor: "#ff0000" });
    expect(built.params).not.toBe(one.params);
    const clamped = buildTransitionAtCut({ ...one, duration: 30 }, clip("a", 0, 1), clip("b", 1, 1), "t-2");
    expect(clamped.duration).toBe(2);
    const edge = buildTransitionAtCut(one, clip("a", 0, 5), undefined, "t-3");
    expect(edge.edge).toBe("out");
    expect(edge.clipBId).toBeUndefined();
  });

  it("applies through transition/set, edits through transition/update, and undoes every step", async () => {
    const ex = new ActionExecutor();
    const p = project();
    const one = preset("p1", "Red iris");
    const built = buildTransitionAtCut(one, p.timeline.tracks[0]!.clips[0]!, p.timeline.tracks[0]!.clips[1]!, "tr-1");
    await ex.execute(act("transition/set", { transition: built }), p);
    expect(p.timeline.tracks[0]!.transitions[0]!.params.borderColor).toBe("#ff0000");

    const edits: Record<string, unknown>[] = [
      { alignment: "start" },
      { feather: 0.6, reverse: true },
      { startPct: 20, endPct: 90 },
      { borderWidth: 12, borderColor: "#00ff00" },
    ];
    for (const edit of edits) {
      expect((await ex.execute(act("transition/update", { transitionId: "tr-1", params: edit }), p)).success).toBe(true);
    }
    const final = p.timeline.tracks[0]!.transitions[0]!;
    expect(final.params).toMatchObject({ alignment: "start", feather: 0.6, reverse: true, startPct: 20, endPct: 90, borderWidth: 12, borderColor: "#00ff00" });
    expect((await ex.execute(act("transition/update", { transitionId: "tr-1", duration: 1.5 }), p)).success).toBe(true);
    expect(p.timeline.tracks[0]!.transitions[0]!.duration).toBe(1.5);

    while (p.timeline.tracks[0]!.transitions[0]?.params.alignment !== undefined || p.timeline.tracks[0]!.transitions[0]?.duration !== 0.8) {
      const before = JSON.stringify(p.timeline.tracks[0]!.transitions);
      await ex.undo(p);
      if (JSON.stringify(p.timeline.tracks[0]!.transitions) === before) break;
    }
    const restored = p.timeline.tracks[0]!.transitions[0]!;
    expect(restored.duration).toBe(0.8);
    expect(restored.params).toMatchObject({ feather: 0.2, borderWidth: 4, borderColor: "#ff0000" });
    expect(restored.params.alignment).toBeUndefined();
    await ex.undo(p);
    expect(p.timeline.tracks[0]!.transitions).toHaveLength(0);
    await ex.redo(p);
    expect(p.timeline.tracks[0]!.transitions).toHaveLength(1);
  });
});
