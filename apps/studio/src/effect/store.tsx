import { nanoid } from "nanoid";
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import { getSubjectCapability } from "./subjects";
import type { Behavior, Scene, Subject, SubjectKind } from "./scene";
import { emptyScene } from "./scene";

export type Selection =
  | null
  | { type: "subject"; id: string }
  | { type: "behavior"; subjectId: string; behaviorId: string };

export interface SceneState {
  scene: Scene;
  selection: Selection;
}

export function initialSceneState(): SceneState {
  return { scene: emptyScene(), selection: null };
}

export type SceneAction =
  | { type: "addSubject"; kind: SubjectKind }
  | { type: "removeSubject"; subjectId: string }
  | { type: "renameSubject"; subjectId: string; name: string }
  | { type: "toggleSubjectVisible"; subjectId: string }
  | { type: "addBehavior"; subjectId: string; behavior: Behavior }
  | { type: "removeBehavior"; subjectId: string; behaviorId: string }
  | { type: "renameBehavior"; subjectId: string; behaviorId: string; name: string }
  | { type: "toggleBehaviorVisible"; subjectId: string; behaviorId: string }
  | { type: "setBehaviorParam"; subjectId: string; behaviorId: string; key: string; value: unknown }
  | { type: "reorderBehavior"; subjectId: string; fromIndex: number; toIndex: number }
  | { type: "select"; selection: Selection }
  | { type: "setSampleClip"; sampleClipId: string }
  | { type: "load"; scene: Scene };

function mapSubject(state: SceneState, id: string, fn: (s: Subject) => Subject): SceneState {
  return {
    ...state,
    scene: {
      ...state.scene,
      subjects: state.scene.subjects.map((s) => (s.id === id ? fn(s) : s)),
    },
  };
}

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case "addSubject": {
      if (state.scene.subjects.some((s) => s.kind === action.kind)) return state;
      const cap = getSubjectCapability(action.kind);
      const subject: Subject = {
        id: nanoid(8),
        kind: action.kind,
        name: cap.defaultName,
        visible: true,
        behaviors: [],
      };
      return {
        scene: { ...state.scene, subjects: [...state.scene.subjects, subject] },
        selection: { type: "subject", id: subject.id },
      };
    }
    case "removeSubject":
      return {
        scene: { ...state.scene, subjects: state.scene.subjects.filter((s) => s.id !== action.subjectId) },
        selection: null,
      };
    case "renameSubject":
      return mapSubject(state, action.subjectId, (s) => ({ ...s, name: action.name }));
    case "toggleSubjectVisible":
      return mapSubject(state, action.subjectId, (s) => ({ ...s, visible: !s.visible }));
    case "addBehavior":
      return {
        ...mapSubject(state, action.subjectId, (s) => ({ ...s, behaviors: [...s.behaviors, action.behavior] })),
        selection: { type: "behavior", subjectId: action.subjectId, behaviorId: action.behavior.id },
      };
    case "removeBehavior": {
      const next = mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.filter((b) => b.id !== action.behaviorId),
      }));
      const sel = state.selection;
      const cleared = sel && sel.type === "behavior" && sel.behaviorId === action.behaviorId;
      return cleared ? { ...next, selection: null } : next;
    }
    case "renameBehavior":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) => (b.id === action.behaviorId ? { ...b, name: action.name } : b)),
      }));
    case "toggleBehaviorVisible":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) => (b.id === action.behaviorId ? { ...b, visible: !b.visible } : b)),
      }));
    case "setBehaviorParam":
      return mapSubject(state, action.subjectId, (s) => ({
        ...s,
        behaviors: s.behaviors.map((b) =>
          b.id === action.behaviorId ? { ...b, params: { ...b.params, [action.key]: action.value } } : b,
        ),
      }));
    case "reorderBehavior":
      return mapSubject(state, action.subjectId, (s) => {
        const arr = [...s.behaviors];
        const [moved] = arr.splice(action.fromIndex, 1);
        if (!moved) return s;
        arr.splice(action.toIndex, 0, moved);
        return { ...s, behaviors: arr };
      });
    case "select":
      return { ...state, selection: action.selection };
    case "setSampleClip":
      return { ...state, scene: { ...state.scene, sampleClipId: action.sampleClipId } };
    case "load":
      return { scene: action.scene, selection: null };
    default:
      return state;
  }
}

const SceneCtx = createContext<{ state: SceneState; dispatch: Dispatch<SceneAction> } | null>(null);

export function SceneProvider({ initial, children }: { initial?: SceneState; children: ReactNode }) {
  const [state, dispatch] = useReducer(sceneReducer, initial ?? initialSceneState());
  return <SceneCtx.Provider value={{ state, dispatch }}>{children}</SceneCtx.Provider>;
}

export function useScene() {
  const ctx = useContext(SceneCtx);
  if (!ctx) throw new Error("useScene must be used inside SceneProvider");
  return ctx;
}
