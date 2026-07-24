import { useState } from "react";
import { SceneProvider, useScene, sceneReducer, initialSceneState, type SceneState } from "./store";
import { SceneTree } from "./SceneTree";
import { Preview } from "./Preview";
import { Inspector } from "./Inspector";
import { BehaviorPaletteSheet } from "./BehaviorPaletteSheet";
import { getBehavior } from "./behaviors/registry";
import { nanoid } from "nanoid";
import type { Behavior, Scene, SubjectKind } from "./scene";

export interface EffectEditorSeed {
  subjectKind: SubjectKind;
  behaviorId: string;
  behaviorParams: Record<string, unknown>;
}

export function EffectEditor({ initialSeed, initialScene }: { initialSeed?: EffectEditorSeed; initialScene?: Scene }) {
  const initial = buildInitialState({ initialSeed, initialScene });
  return (
    <SceneProvider initial={initial}>
      <EffectEditorBody />
    </SceneProvider>
  );
}

function buildInitialState({
  initialSeed,
  initialScene,
}: {
  initialSeed?: EffectEditorSeed;
  initialScene?: Scene;
}): SceneState {
  if (initialScene) {
    return { scene: initialScene, selection: null };
  }
  let state = initialSceneState();
  if (initialSeed) {
    state = sceneReducer(state, { type: "addSubject", kind: initialSeed.subjectKind });
    const subjectId = state.scene.subjects[0].id;
    const def = getBehavior(initialSeed.behaviorId);
    if (def) {
      const behavior: Behavior =
        def.kind === "preset"
          ? {
              id: nanoid(8),
              kind: "preset",
              presetId: def.id,
              params: { ...initialSeed.behaviorParams },
              name: def.label,
              visible: true,
            }
          : {
              id: nanoid(8),
              kind: "atomic",
              atomicKind: def.atomicKind!,
              params: { ...initialSeed.behaviorParams },
              name: def.label,
              visible: true,
            };
      state = sceneReducer(state, { type: "addBehavior", subjectId, behavior });
    }
  }
  return state;
}

function EffectEditorBody() {
  const { state, dispatch } = useScene();
  const [paletteFor, setPaletteFor] = useState<{ subjectId: string; kind: SubjectKind } | null>(null);

  function openPalette() {
    const sel = state.selection;
    if (!sel) return;
    const subjectId = sel.type === "subject" ? sel.id : sel.subjectId;
    const subject = state.scene.subjects.find((s) => s.id === subjectId);
    if (!subject) return;
    setPaletteFor({ subjectId, kind: subject.kind });
  }

  function onAddFromPalette(behaviorId: string) {
    if (!paletteFor) return;
    const def = getBehavior(behaviorId);
    if (!def) return;
    const behavior: Behavior =
      def.kind === "preset"
        ? {
            id: nanoid(8),
            kind: "preset",
            presetId: def.id,
            params: { ...(def.defaultParams as Record<string, unknown>) },
            name: def.label,
            visible: true,
          }
        : {
            id: nanoid(8),
            kind: "atomic",
            atomicKind: def.atomicKind!,
            params: { ...(def.defaultParams as Record<string, unknown>) },
            name: def.label,
            visible: true,
          };
    dispatch({ type: "addBehavior", subjectId: paletteFor.subjectId, behavior });
    setPaletteFor(null);
  }

  const sel = state.selection;
  const selectedSubject =
    sel?.type === "subject"
      ? state.scene.subjects.find((s) => s.id === sel.id)
      : sel?.type === "behavior"
        ? state.scene.subjects.find((s) => s.id === sel.subjectId)
        : null;

  return (
    <div className="relative grid h-full grid-cols-[240px_1fr_320px]">
      <div className="relative flex flex-col">
        <SceneTree />
        {selectedSubject && (
          <button
            type="button"
            onClick={openPalette}
            className="absolute bottom-3 left-3 right-3 rounded border border-blue-700 bg-blue-900/30 py-1.5 text-xs text-blue-200 hover:bg-blue-900/50"
          >
            + Add behavior to {selectedSubject.name}
          </button>
        )}
      </div>
      <Preview />
      <Inspector />
      {paletteFor && (
        <BehaviorPaletteSheet
          subjectKind={paletteFor.kind}
          onAdd={onAddFromPalette}
          onClose={() => setPaletteFor(null)}
        />
      )}
    </div>
  );
}
