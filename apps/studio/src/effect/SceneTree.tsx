import { useState } from "react";
import { Icon } from "../icons";
import { useScene } from "./store";
import { getSubjectCapability, listSubjectKinds } from "./subjects";
import type { SubjectKind } from "./scene";

export function SceneTree() {
  const { state, dispatch } = useScene();
  const [pickerOpen, setPickerOpen] = useState(false);

  const usedKinds = new Set(state.scene.subjects.map((s) => s.kind));

  return (
    <aside className="relative flex h-full w-60 flex-col border-r border-zinc-800 bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Scene</span>
        <button
          type="button"
          className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-700"
          onClick={() => setPickerOpen(true)}
        >
          + Subject
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-1 py-2">
        {state.scene.subjects.length === 0 ? (
          <p className="px-2 text-xs text-zinc-600">No subjects yet — start by adding one.</p>
        ) : (
          state.scene.subjects.map((subject) => {
            const cap = getSubjectCapability(subject.kind);
            const selected = state.selection?.type === "subject" && state.selection.id === subject.id;
            return (
              <div key={subject.id} className="mb-2">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => dispatch({ type: "select", selection: { type: "subject", id: subject.id } })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      dispatch({ type: "select", selection: { type: "subject", id: subject.id } });
                    }
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${
                    selected ? "bg-blue-900/40 text-white" : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <Icon name={cap.iconName} size={14} />
                  <span className="flex-1 truncate">{subject.name}</span>
                  <button
                    type="button"
                    aria-label={`Toggle ${subject.name} visibility`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "toggleSubjectVisible", subjectId: subject.id });
                    }}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    <Icon name="eye" size={12} />
                  </button>
                </div>

                <ul className="ml-4 mt-0.5">
                  {subject.behaviors.map((b) => {
                    const bSelected =
                      state.selection?.type === "behavior" && state.selection.behaviorId === b.id;
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "select",
                              selection: { type: "behavior", subjectId: subject.id, behaviorId: b.id },
                            })
                          }
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                            bSelected ? "bg-blue-900/40 text-white" : "text-zinc-400 hover:bg-zinc-900"
                          }`}
                        >
                          <span className="text-zinc-700">↳</span>
                          <span className="flex-1 truncate">{b.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>

      {pickerOpen && (
        <div
          role="dialog"
          aria-label="Add subject"
          className="absolute left-3 top-12 z-10 w-48 rounded border border-zinc-800 bg-zinc-900 p-2 shadow-xl"
        >
          <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500">Add subject</div>
          {listSubjectKinds().map((kind: SubjectKind) => {
            const cap = getSubjectCapability(kind);
            const disabled = usedKinds.has(kind);
            return (
              <button
                type="button"
                key={kind}
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  dispatch({ type: "addSubject", kind });
                  setPickerOpen(false);
                }}
              >
                <Icon name={cap.iconName} size={14} />
                <span>{cap.defaultName}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="mt-1 w-full text-center text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={() => setPickerOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </aside>
  );
}
