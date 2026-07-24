import { describe, it, expect } from "vitest";
import { sceneReducer, initialSceneState, type SceneState } from "./store";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function init(): SceneState {
  return initialSceneState();
}

describe("scene store", () => {
  it("addSubject appends a subject of the chosen kind with default name and selects it", () => {
    const s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    expect(s.scene.subjects).toHaveLength(1);
    expect(s.scene.subjects[0].kind).toBe("face");
    expect(s.scene.subjects[0].name).toBe("Face");
    expect(s.scene.subjects[0].visible).toBe(true);
    expect(s.selection).toEqual({ type: "subject", id: s.scene.subjects[0].id });
  });

  it("addSubject refuses to add a duplicate kind", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    s = sceneReducer(s, { type: "addSubject", kind: "face" });
    expect(s.scene.subjects).toHaveLength(1);
  });

  it("addBehavior appends a behavior to the named subject and selects it", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: {
        id: "b-1",
        kind: "preset",
        presetId: sparkles.id,
        params: sparkles.defaultParams as Record<string, unknown>,
        name: sparkles.label,
        visible: true,
      },
    });
    expect(s.scene.subjects[0].behaviors).toHaveLength(1);
    expect(s.selection).toEqual({ type: "behavior", subjectId, behaviorId: "b-1" });
  });

  it("setBehaviorParam updates one param on a behavior", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: {
        id: "b-1", kind: "preset", presetId: sparkles.id,
        params: { ...sparkles.defaultParams as Record<string, unknown> },
        name: sparkles.label, visible: true,
      },
    });
    s = sceneReducer(s, { type: "setBehaviorParam", subjectId, behaviorId: "b-1", key: "amount", value: 0.9 });
    const params = s.scene.subjects[0].behaviors[0].params as { amount: number };
    expect(params.amount).toBe(0.9);
  });

  it("removeBehavior drops the behavior and clears selection if it was selected", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior",
      subjectId,
      behavior: { id: "b-1", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams as Record<string, unknown>, name: "S", visible: true },
    });
    s = sceneReducer(s, { type: "removeBehavior", subjectId, behaviorId: "b-1" });
    expect(s.scene.subjects[0].behaviors).toHaveLength(0);
    expect(s.selection).toBeNull();
  });

  it("reorderBehavior moves a behavior in its subject's list", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    const sparkles = getBehavior("preset.sparkles.face.v1")!;
    const ft = getBehavior("preset.face-tint.v1")!;
    s = sceneReducer(s, {
      type: "addBehavior", subjectId,
      behavior: { id: "b-1", kind: "preset", presetId: sparkles.id, params: sparkles.defaultParams as Record<string, unknown>, name: "S", visible: true },
    });
    s = sceneReducer(s, {
      type: "addBehavior", subjectId,
      behavior: { id: "b-2", kind: "preset", presetId: ft.id, params: ft.defaultParams as Record<string, unknown>, name: "FT", visible: true },
    });
    s = sceneReducer(s, { type: "reorderBehavior", subjectId, fromIndex: 1, toIndex: 0 });
    expect(s.scene.subjects[0].behaviors.map((b) => b.id)).toEqual(["b-2", "b-1"]);
  });

  it("removeSubject also removes its behaviors and clears selection if needed", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    s = sceneReducer(s, { type: "removeSubject", subjectId });
    expect(s.scene.subjects).toHaveLength(0);
    expect(s.selection).toBeNull();
  });

  it("rename actions update name fields", () => {
    let s = sceneReducer(init(), { type: "addSubject", kind: "face" });
    const subjectId = s.scene.subjects[0].id;
    s = sceneReducer(s, { type: "renameSubject", subjectId, name: "My Face" });
    expect(s.scene.subjects[0].name).toBe("My Face");
  });

  it("setSampleClip changes the scene's sampleClipId", () => {
    let s = init();
    s = sceneReducer(s, { type: "setSampleClip", sampleClipId: "body-fullshot-03" });
    expect(s.scene.sampleClipId).toBe("body-fullshot-03");
  });
});
