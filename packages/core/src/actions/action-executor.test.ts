import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Project } from "../types/project";
import type { Action } from "../types/actions";

function makeProject(): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { duration: 0, tracks: [] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

function makeProjectWithClip(clipOverrides: Record<string, unknown> = {}): Project {
  const clip = {
    id: "c1",
    mediaId: "m1",
    trackId: "t1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
    ...clipOverrides,
  };
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      duration: 5,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [clip],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

function importAction(): Action {
  const file = {
    name: "clip.mp4",
    type: "video/mp4",
    size: 1024,
  } as unknown as File;
  return {
    id: "import-1",
    type: "media/import",
    params: { file },
    timestamp: Date.now(),
  } as unknown as Action;
}

describe("ActionExecutor media/import undo", () => {
  it("adds media on execute and removes it on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(importAction(), project);
    expect(result.success).toBe(true);
    expect(project.mediaLibrary.items).toHaveLength(1);

    const undo = await executor.undo(project);
    expect(undo.success).toBe(true);
    expect(project.mediaLibrary.items).toHaveLength(0);
  });

  it("re-adds the media on redo", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    await executor.execute(importAction(), project);
    await executor.undo(project);
    expect(project.mediaLibrary.items).toHaveLength(0);

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.mediaLibrary.items).toHaveLength(1);
  });
});

describe("ActionExecutor grouped generated IDs", () => {
  it("undoes every rapidly-added track in one history group", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    executor.getHistory().beginGroup("Add overlay tracks");

    for (const [id, trackType] of [
      ["track-add-text", "text"],
      ["track-add-graphics", "graphics"],
    ] as const) {
      const result = await executor.execute(
        {
          id,
          type: "track/add",
          params: { trackType },
          timestamp: Date.now(),
        } as Action,
        project,
      );
      expect(result.success).toBe(true);
    }
    executor.getHistory().endGroup();

    expect(project.timeline.tracks).toHaveLength(2);
    expect(new Set(project.timeline.tracks.map((track) => track.id)).size).toBe(2);

    const undo = await executor.undo(project);
    expect(undo.success).toBe(true);
    expect(project.timeline.tracks).toHaveLength(0);
  });
});

describe("ActionExecutor transform/update", () => {
  it("deep-merges a partial axis (does not drop the other) and round-trips", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const before = JSON.stringify(project);

    const result = await executor.execute(
      {
        id: "tf-1",
        type: "transform/update",
        params: { clipId: "c1", transform: { position: { x: 100 } } },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].transform.position).toEqual({
      x: 100,
      y: 0,
    });

    await executor.undo(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe("ActionExecutor compound instance synchronization", () => {
  it("keeps persisted nested timing aligned with timeline move and trim edits", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      id: "instance-1",
      mediaId: "compound:compound-1",
      metadata: { compoundClipId: "compound-1" },
    }) as Project & { nestedInstances: Array<Record<string, unknown>> };
    project.nestedInstances = [{
      id: "instance-1",
      compoundClipId: "compound-1",
      trackId: "t1",
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      transform: project.timeline.tracks[0].clips[0].transform,
      volume: 1,
    }];

    await executor.execute({
      id: "move-compound",
      type: "clip/move",
      timestamp: Date.now(),
      params: { clipId: "instance-1", startTime: 8 },
    } as Action, project);
    await executor.execute({
      id: "trim-compound",
      type: "clip/trim",
      timestamp: Date.now(),
      params: { clipId: "instance-1", outPoint: 3 },
    } as Action, project);

    expect(project.nestedInstances[0]).toMatchObject({
      startTime: 8,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
    });
  });
});

describe("ActionExecutor clip/setBlendMode", () => {
  it("sets blend mode and restores prior (undefined -> normal) on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();

    const result = await executor.execute(
      {
        id: "bm-1",
        type: "clip/setBlendMode",
        params: { clipId: "c1", blendMode: "multiply" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].blendMode).toBe("multiply");

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].blendMode).toBe("normal");

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].blendMode).toBe("multiply");
  });

  it("restores a prior explicit blend mode on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({ blendMode: "screen" });

    await executor.execute(
      {
        id: "bm-2",
        type: "clip/setBlendMode",
        params: { clipId: "c1", blendMode: "overlay" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].blendMode).toBe("overlay");

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].blendMode).toBe("screen");
  });
});

describe("ActionExecutor clip/setBlendOpacity", () => {
  it("sets opacity and restores prior (undefined -> 100) on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();

    await executor.execute(
      {
        id: "bo-1",
        type: "clip/setBlendOpacity",
        params: { clipId: "c1", opacity: 40 },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].blendOpacity).toBe(40);

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].blendOpacity).toBe(100);
  });
});

describe("ActionExecutor clip/setEmphasisAnimation", () => {
  it("sets emphasis animation and restores prior (undefined) on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const animation = { type: "pulse", intensity: 0.5, speed: 1 };

    await executor.execute(
      {
        id: "ea-1",
        type: "clip/setEmphasisAnimation",
        params: { clipId: "c1", emphasisAnimation: animation },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].emphasisAnimation).toEqual(
      animation,
    );

    await executor.undo(project);
    expect(
      project.timeline.tracks[0].clips[0].emphasisAnimation,
    ).toBeUndefined();
  });
});

function makeProjectWithMarkers(
  markers: Array<{ id: string; time: number; label: string; color: string }> = [],
): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { duration: 0, tracks: [], markers },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

describe("ActionExecutor marker/add", () => {
  it("adds a marker on execute and removes it on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithMarkers();

    const result = await executor.execute(
      {
        id: "ma-1",
        type: "marker/add",
        params: { time: 5, label: "Scene 1", color: "#ff0000" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.markers).toHaveLength(1);
    expect(project.timeline.markers[0].time).toBe(5);

    await executor.undo(project);
    expect(project.timeline.markers).toHaveLength(0);
  });
});

describe("ActionExecutor marker/remove", () => {
  it("restores the exact marker (id + fields + position) on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithMarkers([
      { id: "m1", time: 2, label: "A", color: "#111111" },
      { id: "m2", time: 7, label: "B", color: "#222222" },
    ]);

    await executor.execute(
      {
        id: "mr-1",
        type: "marker/remove",
        params: { markerId: "m1" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.markers.map((m) => m.id)).toEqual(["m2"]);

    await executor.undo(project);
    expect(project.timeline.markers.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(project.timeline.markers[0]).toEqual({
      id: "m1",
      time: 2,
      label: "A",
      color: "#111111",
    });
  });
});

describe("ActionExecutor marker/update", () => {
  it("applies partial updates and reverts all fields on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithMarkers([
      { id: "m1", time: 2, label: "A", color: "#111111" },
    ]);

    await executor.execute(
      {
        id: "mu-1",
        type: "marker/update",
        params: { markerId: "m1", updates: { label: "Renamed", time: 9 } },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.markers[0]).toEqual({
      id: "m1",
      time: 9,
      label: "Renamed",
      color: "#111111",
    });

    await executor.undo(project);
    expect(project.timeline.markers[0]).toEqual({
      id: "m1",
      time: 2,
      label: "A",
      color: "#111111",
    });
  });
});

describe("ActionExecutor track/rename", () => {
  it("renames the track and restores the prior name on undo/redo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    expect(project.timeline.tracks[0].name).toBe("V1");

    const result = await executor.execute(
      {
        id: "tr-1",
        type: "track/rename",
        params: { trackId: "t1", name: "Main Camera" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].name).toBe("Main Camera");

    await executor.undo(project);
    expect(project.timeline.tracks[0].name).toBe("V1");

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].name).toBe("Main Camera");
  });
});

describe("ActionExecutor track/duplicate", () => {
  it("duplicates clips and remaps transition references with one-step undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithTransitions([
      {
        id: "transition-source",
        clipAId: "c1",
        clipBId: "c2",
        type: "crossfade",
        duration: 1,
        params: {},
      },
    ]);

    const result = await executor.execute(
      {
        id: "duplicate-track-1",
        type: "track/duplicate",
        params: { sourceTrackId: "t1", position: 1 },
        timestamp: Date.now(),
      },
      project,
    );

    expect(result.success).toBe(true);
    expect(project.timeline.tracks).toHaveLength(2);
    const source = project.timeline.tracks[0];
    const duplicate = project.timeline.tracks[1];
    expect(duplicate.name).toBe("V1 Copy");
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.clips.map((clip) => clip.id)).not.toEqual(
      source.clips.map((clip) => clip.id),
    );
    expect(duplicate.clips.every((clip) => clip.trackId === duplicate.id)).toBe(
      true,
    );
    expect(duplicate.transitions[0]).toMatchObject({
      clipAId: duplicate.clips[0].id,
      clipBId: duplicate.clips[1].id,
    });
    expect(duplicate.transitions[0].id).not.toBe("transition-source");

    await executor.undo(project);
    expect(project.timeline.tracks).toHaveLength(1);

    await executor.redo(project);
    expect(project.timeline.tracks).toHaveLength(2);
    expect(project.timeline.tracks[1].name).toBe("V1 Copy");
  });
});

function makeProjectWithTransitions(
  transitions: Array<Record<string, unknown>> = [],
): Project {
  const mkClip = (id: string, startTime: number) => ({
    id,
    mediaId: "m1",
    trackId: "t1",
    startTime,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  });
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      duration: 10,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [mkClip("c1", 0), mkClip("c2", 5)],
          transitions,
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

describe("ActionExecutor transition/set", () => {
  it("adds a transition and removes it on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithTransitions();
    const transition = {
      id: "tr1",
      clipAId: "c1",
      clipBId: "c2",
      type: "fade",
      duration: 1,
      params: {},
    };

    const result = await executor.execute(
      {
        id: "ts-1",
        type: "transition/set",
        params: { transition },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].transitions).toEqual([transition]);

    await executor.undo(project);
    expect(project.timeline.tracks[0].transitions).toEqual([]);

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].transitions[0].id).toBe("tr1");
  });

  it("replaces an existing transition between the same clips and restores it on undo", async () => {
    const executor = new ActionExecutor();
    const existing = {
      id: "old",
      clipAId: "c1",
      clipBId: "c2",
      type: "fade",
      duration: 1,
      params: {},
    };
    const project = makeProjectWithTransitions([existing]);
    const replacement = {
      id: "new",
      clipAId: "c1",
      clipBId: "c2",
      type: "wipe",
      duration: 2,
      params: {},
    };

    await executor.execute(
      {
        id: "ts-2",
        type: "transition/set",
        params: { transition: replacement },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].transitions.map((t) => t.id)).toEqual([
      "new",
    ]);

    await executor.undo(project);
    expect(project.timeline.tracks[0].transitions).toEqual([existing]);
  });
});

describe("ActionExecutor transition/update", () => {
  it("reverts type and duration on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithTransitions([
      {
        id: "tr1",
        clipAId: "c1",
        clipBId: "c2",
        type: "fade",
        duration: 1,
        params: {},
      },
    ]);

    await executor.execute(
      {
        id: "tu-1",
        type: "transition/update",
        params: { transitionId: "tr1", type: "wipe", duration: 3 },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].transitions[0].type).toBe("wipe");
    expect(project.timeline.tracks[0].transitions[0].duration).toBe(3);

    await executor.undo(project);
    expect(project.timeline.tracks[0].transitions[0].type).toBe("fade");
    expect(project.timeline.tracks[0].transitions[0].duration).toBe(1);
  });
});

describe("ActionExecutor transition/remove", () => {
  it("restores a removed transition on undo", async () => {
    const executor = new ActionExecutor();
    const transition = {
      id: "tr1",
      clipAId: "c1",
      clipBId: "c2",
      type: "fade",
      duration: 1,
      params: {},
    };
    const project = makeProjectWithTransitions([transition]);

    await executor.execute(
      {
        id: "trm-1",
        type: "transition/remove",
        params: { transitionId: "tr1" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].transitions).toEqual([]);

    await executor.undo(project);
    expect(project.timeline.tracks[0].transitions[0].id).toBe("tr1");
  });
});

describe("ActionExecutor clip/setColorGrading", () => {
  it("sets color grading and reverts to undefined on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const grading = {
      temperature: 20,
      tint: -5,
      lut: { data: [1, 2, 3, 4], size: 2, intensity: 0.8 },
    };

    const result = await executor.execute(
      {
        id: "cg-1",
        type: "clip/setColorGrading",
        params: { clipId: "c1", colorGrading: grading },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].colorGrading).toEqual(grading);

    await executor.undo(project);
    expect(
      project.timeline.tracks[0].clips[0].colorGrading,
    ).toBeUndefined();

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].colorGrading).toEqual(grading);
  });

  it("restores prior grading when reset to undefined, then undone", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      colorGrading: { temperature: 10, tint: 0 },
    });

    await executor.execute(
      {
        id: "cg-2",
        type: "clip/setColorGrading",
        params: { clipId: "c1", colorGrading: undefined },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(
      project.timeline.tracks[0].clips[0].colorGrading,
    ).toBeUndefined();

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].colorGrading).toEqual({
      temperature: 10,
      tint: 0,
    });
  });
});

describe("ActionExecutor effect actions", () => {
  it("adds an effect with the provided id and removes it on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();

    const result = await executor.execute(
      {
        id: "ef-1",
        type: "effect/add",
        params: {
          clipId: "c1",
          effectType: "brightness",
          params: { value: 10 },
          effectId: "fx1",
        },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].effects).toEqual([
      { id: "fx1", type: "brightness", params: { value: 10 }, enabled: true },
    ]);

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].effects).toHaveLength(0);

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].effects[0].id).toBe("fx1");
  });

  it("inserts a duplicated disabled effect at the requested position", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      effects: [
        { id: "fx-a", type: "blur", params: { radius: 8 }, enabled: true },
        { id: "fx-b", type: "glow", params: {}, enabled: true },
      ],
    });

    await executor.execute(
      {
        id: "ef-copy",
        type: "effect/add",
        params: {
          clipId: "c1",
          effectType: "blur",
          params: { radius: 24 },
          effectId: "fx-copy",
          index: 1,
          enabled: false,
        },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );

    expect(project.timeline.tracks[0].clips[0].effects).toEqual([
      expect.objectContaining({ id: "fx-a" }),
      {
        id: "fx-copy",
        type: "blur",
        params: { radius: 24 },
        enabled: false,
      },
      expect.objectContaining({ id: "fx-b" }),
    ]);
    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].effects.map((effect) => effect.id))
      .toEqual(["fx-a", "fx-b"]);
  });

  it("toggles enabled and reverts on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      effects: [
        { id: "fx1", type: "blur", params: {}, enabled: true },
      ],
    });

    await executor.execute(
      {
        id: "ef-2",
        type: "effect/toggle",
        params: { clipId: "c1", effectId: "fx1", enabled: false },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].effects[0].enabled).toBe(false);

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].effects[0].enabled).toBe(true);
  });

  it("restores prior params after an effect/update undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      effects: [
        { id: "fx1", type: "brightness", params: { value: 5 }, enabled: true },
      ],
    });

    await executor.execute(
      {
        id: "ef-3",
        type: "effect/update",
        params: { clipId: "c1", effectId: "fx1", params: { value: 25 } },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].effects[0].params).toEqual({
      value: 25,
    });

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].effects[0].params).toEqual({
      value: 5,
    });
  });

  it("restores a removed effect at its original index on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      effects: [
        { id: "fx1", type: "blur", params: {}, enabled: true },
        { id: "fx2", type: "brightness", params: { value: 3 }, enabled: true },
      ],
    });

    await executor.execute(
      {
        id: "ef-4",
        type: "effect/remove",
        params: { clipId: "c1", effectId: "fx1" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(
      project.timeline.tracks[0].clips[0].effects.map((e) => e.id),
    ).toEqual(["fx2"]);

    await executor.undo(project);
    expect(
      project.timeline.tracks[0].clips[0].effects.map((e) => e.id),
    ).toEqual(["fx1", "fx2"]);
  });
});

describe("ActionExecutor audio effect actions", () => {
  it("adds an audio effect and removes it on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const effect = { id: "aef1", type: "eq", enabled: true, params: { gain: 2 } };

    const result = await executor.execute(
      {
        id: "aae-1",
        type: "audio/addEffect",
        params: { clipId: "c1", effect },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects).toEqual([effect]);

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].audioEffects).toHaveLength(0);

    const redo = await executor.redo(project);
    expect(redo.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0].id).toBe("aef1");
  });

  it("restores a removed audio effect at its index on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      audioEffects: [
        { id: "aef1", type: "eq", enabled: true, params: {} },
        { id: "aef2", type: "reverb", enabled: true, params: { wet: 0.3 } },
      ],
    });

    await executor.execute(
      {
        id: "are-1",
        type: "audio/removeEffect",
        params: { clipId: "c1", effectId: "aef1" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(
      project.timeline.tracks[0].clips[0].audioEffects.map((e) => e.id),
    ).toEqual(["aef2"]);

    await executor.undo(project);
    expect(
      project.timeline.tracks[0].clips[0].audioEffects.map((e) => e.id),
    ).toEqual(["aef1", "aef2"]);
  });

  it("reverts audio effect params and enabled on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      audioEffects: [
        { id: "aef1", type: "eq", enabled: true, params: { gain: 1 } },
      ],
    });

    await executor.execute(
      {
        id: "aue-1",
        type: "audio/updateEffect",
        params: { clipId: "c1", effectId: "aef1", params: { gain: 9 } },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].audioEffects[0].params).toEqual({
      gain: 9,
    });

    await executor.execute(
      {
        id: "ate-1",
        type: "audio/toggleEffect",
        params: { clipId: "c1", effectId: "aef1", enabled: false },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.tracks[0].clips[0].audioEffects[0].enabled).toBe(
      false,
    );

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0].enabled).toBe(
      true,
    );

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].audioEffects[0].params).toEqual({
      gain: 1,
    });
  });
});

describe("ActionExecutor clip/remove cloneClip fidelity", () => {
  it("restores audioEffects and blendMode on undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({
      audioEffects: [{ id: "ae1", type: "eq", enabled: true, params: { gain: 3 } }],
      blendMode: "multiply",
    });

    const result = await executor.execute(
      {
        id: "rm-1",
        type: "clip/remove",
        params: { clipId: "c1" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips).toHaveLength(0);

    await executor.undo(project);
    const restored = project.timeline.tracks[0].clips[0];
    expect(restored.audioEffects).toEqual([
      { id: "ae1", type: "eq", enabled: true, params: { gain: 3 } },
    ]);
    expect(restored.blendMode).toBe("multiply");
  });
});

describe("ActionExecutor project/setCanvasBackground", () => {
  it("sets canvas background fill mode + color and undoes back to none", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      {
        id: "bg-1",
        type: "project/setCanvasBackground",
        params: { backgroundFillMode: "color", layoutBackgroundColor: "#16A34A" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.backgroundFillMode).toBe("color");
    expect(project.timeline.layoutBackgroundColor).toBe("#16A34A");

    await executor.undo(project);
    expect(project.timeline.backgroundFillMode).toBeUndefined();
    expect(project.timeline.layoutBackgroundColor).toBeUndefined();
  });

  it("switches to blur mode preserving prior color, and redo restores it", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    await executor.execute(
      {
        id: "bg-2a",
        type: "project/setCanvasBackground",
        params: { backgroundFillMode: "color", layoutBackgroundColor: "#2563EB" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    await executor.execute(
      {
        id: "bg-2b",
        type: "project/setCanvasBackground",
        params: { backgroundFillMode: "blur", layoutBackgroundColor: "#2563EB" },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );
    expect(project.timeline.backgroundFillMode).toBe("blur");

    await executor.undo(project);
    expect(project.timeline.backgroundFillMode).toBe("color");
    expect(project.timeline.layoutBackgroundColor).toBe("#2563EB");

    await executor.redo(project);
    expect(project.timeline.backgroundFillMode).toBe("blur");
  });
});

describe("ActionExecutor project/registerGeneratedShader", () => {
  it("is a no-op when the def id collides with a built-in shader", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      {
        id: "gs-1",
        type: "project/registerGeneratedShader",
        params: {
          def: {
            id: "liquid-metal",
            name: "Impostor",
            category: "fill",
            glsl: "x",
            params: [],
            origin: "generated",
          },
        },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );

    expect(result.success).toBe(true);
    expect((project as unknown as { generatedShaders?: unknown[] }).generatedShaders ?? []).toHaveLength(0);
  });

  it("registers and stores a namespaced generated shader", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      {
        id: "gs-2",
        type: "project/registerGeneratedShader",
        params: {
          def: {
            id: "ai-example-abcd1234",
            name: "Example",
            category: "fill",
            glsl: "x",
            params: [],
            origin: "generated",
          },
        },
        timestamp: Date.now(),
      } as unknown as Action,
      project,
    );

    expect(result.success).toBe(true);
    expect(
      (project as unknown as { generatedShaders?: Array<{ id: string }> }).generatedShaders?.map(
        (d) => d.id,
      ),
    ).toEqual(["ai-example-abcd1234"]);
  });
});
