import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import { getClipFadeEnvelopePoints } from "../audio/clip-fade-envelope";
import { getVolumeAutomationPointsForRange } from "../audio/clip-volume-automation";
import { createEffectFromPreset } from "../effects/particle-presets";
import {
  projectParticleEffects,
  sampleParticleEffect,
} from "../effects/particle-sampling";
import { SpeedEngine } from "../video/speed-engine";
import { TitleEngine } from "../text/title-engine";
import {
  MOTION_SHADER_LIBRARY,
  defaultMotionShaderParams,
} from "../motion/shaders";
import type { Clip, Project } from "../types";
import {
  createClipFragment,
  fragmentAutomation,
  prepareClipSplit,
} from "./clip-fragments";
import {
  applyTimelineToolEdits,
  validateTimelineToolEdits,
} from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
function fixture(overrides: Partial<Clip> = {}): Project {
  const clip: Clip = {
    id: "source",
    mediaId: "video",
    trackId: "main",
    startTime: 10,
    duration: 4,
    inPoint: 4,
    outPoint: 12,
    speed: 2,
    volume: 0.8,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform,
    ...overrides,
  };
  return {
    id: "project",
    name: "Fragments",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 640,
      height: 360,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    mediaLibrary: {
      items: [
        {
          id: "video",
          name: "Source.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["video"]),
          thumbnailUrl: null,
          waveformData: new Float32Array(65536),
          metadata: {
            duration: 30,
            width: 640,
            height: 360,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            codec: "h264",
            fileSize: 5,
          },
        },
      ],
    },
    timeline: {
      duration: 14,
      markers: [],
      subtitles: [],
      tracks: [
        {
          id: "main",
          name: "Main",
          type: "video",
          clips: [clip],
          transitions: [],
          hidden: false,
          locked: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}
const pieces = (project: Project) => project.timeline.tracks[0].clips;
const split = (project: Project, operation = "split") =>
  prepareClipSplit(project, "source", 11.5, operation);
function executor() {
  const history = new ActionHistory();
  history.setAutoGroupWindow(0);
  return new ActionExecutor(history);
}
function frameTime(engine: SpeedEngine, clip: Clip, time: number) {
  engine.setClipSpeed(
    clip.id,
    Math.abs(clip.speed ?? 1),
    clip.outPoint - clip.inPoint,
  );
  engine.setReverse(
    clip.id,
    clip.reversed === true || (clip.speed ?? 1) < 0,
    clip.outPoint - clip.inPoint,
  );
  return (
    clip.inPoint +
    engine.getSourceTimeAtPlaybackTime(clip.id, time - clip.startTime)
  );
}
function fadeAt(clip: Clip, time: number) {
  return (
    getClipFadeEnvelopePoints({
      clipOffset: time,
      rangeDuration: 0.00001,
      clipDuration: clip.duration,
      fadeIn: clip.fade?.fadeIn,
      fadeOut: clip.fade?.fadeOut,
      fadeOrigin: clip.fade?.origin,
    })[0]?.value ?? 1
  );
}

describe("source-preserving Split", () => {
  it.each([
    { speed: 2, reversed: false },
    { speed: 0.5, reversed: false },
    { speed: 2, reversed: true },
    { speed: -2, reversed: false },
  ])(
    "retains source frames and stable exact history at %j",
    async ({ speed, reversed }) => {
      const project = fixture({
          speed,
          reversed,
          outPoint: 4 + 4 * Math.abs(speed),
        }),
        before = structuredClone(pieces(project)[0]),
        engine = new SpeedEngine(),
        actions = executor();
      const expected = [10, 10.75, 11.499, 11.5, 12.125, 13.999].map((time) =>
        frameTime(engine, before, time),
      );
      const result = await actions.execute(
        {
          id: "split",
          type: "clip/split",
          timestamp: 1,
          params: { clipId: "source", time: 11.5 },
        },
        project,
      );
      expect(result.success).toBe(true);
      expect(
        pieces(project).map(({ startTime, duration }) => [startTime, duration]),
      ).toEqual([
        [10, 1.5],
        [11.5, 2.5],
      ]);
      for (const [index, time] of [
        10, 10.75, 11.499, 11.5, 12.125, 13.999,
      ].entries()) {
        const piece = pieces(project).find(
          (clip) =>
            time >= clip.startTime && time < clip.startTime + clip.duration,
        )!;
        expect(frameTime(engine, piece, time)).toBeCloseTo(expected[index], 12);
      }
      const savedPieces = structuredClone(pieces(project));
      expect((await actions.undo(project)).success).toBe(true);
      expect(pieces(project)).toEqual([before]);
      expect(frameTime(engine, pieces(project)[0], 10)).toBe(
        frameTime(new SpeedEngine(), before, 10),
      );
      expect((await actions.redo(project)).success).toBe(true);
      expect(pieces(project)).toEqual(savedPieces);
    },
  );

  it("does not remove an independent overlapping clip on Undo or traverse media data", async () => {
    const project = fixture(),
      actions = executor(),
      independent = {
        ...pieces(project)[0],
        id: "overlap",
        startTime: 11,
        duration: 1,
        outPoint: 6,
      };
    project.timeline.tracks[0].clips.push(independent);
    const media = project.mediaLibrary;
    Object.assign(media.items[0].waveformData!, {
      toJSON() {
        throw new Error("Waveform traversal");
      },
    });
    expect(
      (
        await actions.execute(
          {
            id: "bounded",
            type: "clip/split",
            timestamp: 1,
            params: { clipId: "source", time: 12 },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect((await actions.undo(project)).success).toBe(true);
    expect(pieces(project).map((clip) => clip.id)).toEqual([
      "source",
      "overlap",
    ]);
    expect(pieces(project)[1]).toBe(independent);
    expect(project.mediaLibrary).toBe(media);
  });

  it.each([NaN, Infinity, 10, 14, 9])(
    "rejects invalid split time %s atomically",
    async (time) => {
      const project = fixture(),
        before = project.timeline,
        actions = executor();
      expect(
        (
          await actions.execute(
            {
              id: "bad",
              type: "clip/split",
              timestamp: 1,
              params: { clipId: "source", time },
            },
            project,
          )
        ).success,
      ).toBe(false);
      expect(project.timeline).toBe(before);
      expect((await actions.undo(project)).success).toBe(false);
    },
  );

  it("rejects locked tracks and existing generated IDs without changing data", () => {
    const project = fixture(),
      plan = split(project);
    project.timeline.tracks[0].clips.push({
      ...pieces(project)[0],
      id: plan.rightClipId,
    });
    expect(() => split(project)).toThrow("already in use");
    project.timeline.tracks[0] = {
      ...project.timeline.tracks[0],
      locked: true,
    };
    expect(() => split(project)).toThrow("Unlock");
  });
});

describe("fragment clocks and attached data", () => {
  it("retains every complete text material and caption record through Split, Undo and Redo", async () => {
    const project = fixture(),
      actions = executor(),
      title = new TitleEngine();
    Object.assign(project, {
      textClips: MOTION_SHADER_LIBRARY.map((def, index) => {
        const clip = title.createTextClip({
          id: `material-${index}`,
          trackId: "titles",
          startTime: 11,
          duration: 2,
          text: def.id,
        });
        return {
          ...clip,
          style: {
            ...clip.style,
            shader: {
              shaderId: def.id,
              params: defaultMotionShaderParams(def),
              progress: 0.37,
            },
          },
          metadata: { sourceClipId: "source" },
        };
      }),
    });
    const original = structuredClone(project.textClips),
      collection = project.textClips;
    expect(original).toHaveLength(49);
    expect(
      (
        await actions.execute(
          {
            id: "materials",
            type: "clip/split",
            timestamp: 1,
            params: { clipId: "source", time: 11.5 },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect(project.textClips).toBe(collection);
    expect(project.textClips).toEqual(original);
    expect((await actions.undo(project)).success).toBe(true);
    expect(project.textClips).toEqual(original);
    expect((await actions.redo(project)).success).toBe(true);
    expect(project.textClips).toEqual(original);
  });
  it("splits compound instances and restores their exact original saved timing", async () => {
    const project = fixture({
        mediaId: "compound:nested",
        metadata: { compoundClipId: "nested" },
      }),
      actions = executor();
    const definition = {
      id: "nested",
      name: "Nested",
      content: { clips: [], tracks: [], duration: 20 },
      createdAt: 0,
      modifiedAt: 0,
      color: "#123456",
    };
    const instance = {
      id: "source",
      compoundClipId: "nested",
      trackId: "main",
      startTime: 9,
      duration: 5,
      inPoint: 2,
      outPoint: 12,
      volume: 0.8,
      transform,
    };
    const unrelated = { ...instance, id: "unrelated" };
    Object.assign(project, {
      compoundClips: [definition],
      nestedInstances: [instance, unrelated],
    });
    expect(
      (
        await actions.execute(
          {
            id: "nested-split",
            type: "clip/split",
            timestamp: 1,
            params: { clipId: "source", time: 11.5 },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect(project.nestedInstances).toHaveLength(3);
    expect(project.nestedInstances![0]).toMatchObject({
      startTime: 10,
      duration: 1.5,
      inPoint: 4,
      outPoint: 7,
    });
    expect(project.nestedInstances![1]).toMatchObject({
      startTime: 11.5,
      duration: 2.5,
      inPoint: 7,
      outPoint: 12,
    });
    expect(project.nestedInstances![2]).toBe(unrelated);
    expect(project.compoundClips![0]).toBe(definition);
    expect((await actions.undo(project)).success).toBe(true);
    expect(project.nestedInstances).toEqual([instance, unrelated]);
    expect((await actions.redo(project)).success).toBe(true);
    expect(project.nestedInstances).toHaveLength(3);
  });
  it("retains fades, eased off-piece keys, effect parameters and metadata through repeated cuts", () => {
    const project = fixture({
      fade: { fadeIn: 3, fadeOut: 3 },
      keyframes: [
        {
          id: "kf-exit-before",
          time: 0,
          property: "opacity",
          value: 0,
          easing: "bezier",
          bezierHandles: { in: { x: 0.2, y: 0.3 }, out: { x: 0.8, y: 0.9 } },
          roving: true,
        },
        {
          id: "template-end",
          time: 4,
          property: "opacity",
          value: 1,
          easing: "linear",
        },
      ],
      metadata: {
        templateSource: { ownerClipId: "source", templateId: "template" },
      } as Clip["metadata"],
      effects: [
        { id: "effect", type: "blur", enabled: true, params: { radius: 3 } },
      ] as Clip["effects"],
    });
    const original = pieces(project)[0],
      after = applyTimelineToolEdits(project, split(project).edits),
      right = pieces(after)[1];
    expect(right.keyframes.map((key) => key.time)).toEqual([-1.5, 2.5]);
    expect(right.keyframes[0].id).toMatch(/^kf-exit-/);
    expect(right.keyframes[0].bezierHandles).toEqual(
      original.keyframes[0].bezierHandles,
    );
    expect(right.metadata?.templateSource?.ownerClipId).toBe(right.id);
    expect(right.effects[0].params).toEqual(original.effects[0].params);
    expect(right.effects[0].id).not.toBe(original.effects[0].id);
    for (const time of [0, 0.1, 0.75, 1.49, 1.5, 2, 3.99]) {
      const piece = time < 1.5 ? pieces(after)[0] : right;
      expect(
        fadeAt(piece, time - (piece.startTime - original.startTime)),
      ).toBeCloseTo(fadeAt(original, time), 12);
    }
    const edited = {
      ...right,
      fade: {
        ...right.fade!,
        fadeIn: 0.5,
        origin: { ...right.fade!.origin!, fadeIn: false },
      },
    };
    const tiny = createClipFragment(
      edited,
      { startTime: 12, fromTime: 12, duration: 1, inserted: false },
      "third",
      after,
    );
    expect(tiny.fade?.origin?.out).toEqual({ offset: 2, duration: 4 });
    for (const local of [0, 0.25, 0.99])
      expect(fadeAt(tiny, local)).toBeCloseTo(fadeAt(edited, 0.5 + local), 12);
  });

  it("interpolates automation boundaries including the ramp before its first key", () => {
    const project = fixture({
      automation: {
        volume: [{ time: 3, value: 0.2 }],
        pan: [{ time: 4, value: 1 }],
      },
    });
    const after = applyTimelineToolEdits(project, split(project).edits),
      right = pieces(after)[1];
    expect(right.automation?.volume?.[0].value).toBeCloseTo(0.5, 12);
    expect(right.automation?.pan?.[0].value).toBeCloseTo(0.375, 12);
    for (const time of [0.01, 0.5, 1, 2.49]) {
      expect(
        getVolumeAutomationPointsForRange(
          right.automation?.volume,
          time,
          0.001,
          right.volume,
        )[0].value,
      ).toBeCloseTo(
        getVolumeAutomationPointsForRange(
          pieces(project)[0].automation?.volume,
          time + 1.5,
          0.001,
          0.8,
        )[0].value,
        12,
      );
    }
    expect(
      fragmentAutomation(
        [
          { time: 1, value: 1 },
          { time: 1, value: 0.25 },
        ],
        1,
        0.5,
        0.8,
        0,
        4,
      )?.[0].value,
    ).toBe(0.25);
  });

  it("preserves particle phase and global mask keyframes and restores owners exactly", async () => {
    const project = fixture(),
      actions = executor();
    Object.assign(project, {
      particleEffects: [
        {
          ...createEffectFromPreset(
            "confetti-celebration",
            "particles",
            "source",
            10,
            4,
          )!,
          clipStartTime: 10,
        },
      ],
      masks: [
        {
          id: "mask",
          clipId: "source",
          type: "drawn",
          path: {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.5, y: 1 },
            ],
          },
          feathering: 3,
          expansion: 0,
          opacity: 0.8,
          inverted: false,
          keyframes: [
            {
              id: "mask-key",
              time: 12,
              easing: "linear",
              path: {
                closed: true,
                points: [
                  { x: 0.1, y: 0.1 },
                  { x: 0.9, y: 0.1 },
                  { x: 0.5, y: 0.9 },
                ],
              },
            },
          ],
        },
      ],
    });
    const original = structuredClone({
      masks: project.masks,
      particles: project.particleEffects,
    });
    const geometry = (p: Project, time: number) =>
      projectParticleEffects(p, time).flatMap((effect) =>
        sampleParticleEffect(effect, time, 640, 360).map(
          ({ id: _id, ...particle }) => particle,
        ),
      );
    const expected = geometry(project, 12.25);
    expect(expected.length).toBeGreaterThan(0);
    expect(
      (
        await actions.execute(
          {
            id: "owners",
            type: "clip/split",
            timestamp: 1,
            params: { clipId: "source", time: 11.5 },
          },
          project,
        )
      ).success,
    ).toBe(true);
    expect(project.masks).toHaveLength(2);
    expect(project.masks![1].keyframes[0].time).toBe(12);
    expect(project.masks![1].clipId).toBe(pieces(project)[1].id);
    expect(geometry(project, 12.25)).toEqual(expected);
    expect(projectParticleEffects(project, 11)).toHaveLength(1);
    expect(projectParticleEffects(project, 12)).toHaveLength(1);
    expect((await actions.undo(project)).success).toBe(true);
    expect(project.masks).toEqual(original.masks);
    expect(project.particleEffects).toEqual(original.particles);
    expect((await actions.redo(project)).success).toBe(true);
    expect(geometry(project, 12.25)).toEqual(expected);
  });

  it("moves outgoing transitions to the right piece and caps edge durations", () => {
    const project = fixture();
    project.timeline.tracks[0] = {
      ...project.timeline.tracks[0],
      transitions: [
        {
          id: "in",
          type: "crossfade",
          clipAId: "source",
          edge: "in",
          duration: 3,
          params: { curve: "smooth" },
        },
        {
          id: "out",
          type: "crossfade",
          clipAId: "source",
          edge: "out",
          duration: 3,
          params: { curve: "smooth" },
        },
      ] as Project["timeline"]["tracks"][number]["transitions"],
    };
    const plan = split(project);
    validateTimelineToolEdits(project, plan.edits);
    const after = applyTimelineToolEdits(project, plan.edits);
    expect(after.timeline.tracks[0].transitions).toMatchObject([
      { id: "in", clipAId: "source", duration: 1.5 },
      { id: "out", clipAId: plan.rightClipId, duration: 2.5 },
    ]);
  });
});
