import type { z } from "zod";
import { useScene } from "./store";
import { getBehavior } from "./behaviors/registry";
import { ParamField, fieldsFromObjectSchema } from "./param-renderers";

export function Inspector() {
  const { state, dispatch } = useScene();
  const selection = state.selection;

  if (!selection) {
    return (
      <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Tips</div>
        <p className="text-xs text-zinc-500">
          Add a subject from the left, then add behaviors to it. Select any item to edit its properties here.
        </p>
      </aside>
    );
  }

  if (selection.type === "subject") {
    const subject = state.scene.subjects.find((s) => s.id === selection.id);
    if (!subject) return null;
    return (
      <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Selected · Subject</div>
        <input
          type="text"
          value={subject.name}
          onChange={(e) =>
            dispatch({ type: "renameSubject", subjectId: subject.id, name: e.target.value })
          }
          className="mt-1 bg-transparent text-sm text-white outline-none"
        />
        <p className="mt-3 text-xs text-zinc-500">
          {subject.behaviors.length} behavior{subject.behaviors.length === 1 ? "" : "s"} attached.
        </p>
        <button
          type="button"
          onClick={() => dispatch({ type: "removeSubject", subjectId: subject.id })}
          className="mt-auto rounded border border-red-900/40 px-2 py-1 text-xs text-red-400 hover:border-red-700"
        >
          Remove subject
        </button>
      </aside>
    );
  }

  const subject = state.scene.subjects.find((s) => s.id === selection.subjectId);
  const behavior = subject?.behaviors.find((b) => b.id === selection.behaviorId);
  if (!behavior) return null;

  const behaviorDefId =
    behavior.kind === "preset"
      ? behavior.presetId
      : `atomic.${behavior.atomicKind}`;
  const def = getBehavior(behaviorDefId);
  if (!def) return null;

  const shape = def.paramSchema as unknown as z.ZodObject<z.ZodRawShape>;
  const fields = fieldsFromObjectSchema(shape);

  return (
    <aside className="flex h-full w-80 flex-col border-l border-zinc-800 bg-zinc-950 p-4">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">Selected · Behavior</div>
      <input
        type="text"
        value={behavior.name}
        onChange={(e) =>
          dispatch({
            type: "renameBehavior",
            subjectId: selection.subjectId,
            behaviorId: behavior.id,
            name: e.target.value,
          })
        }
        className="mt-1 bg-transparent text-sm text-white outline-none"
      />
      <div className="mt-1 text-[10px] text-zinc-600">on {subject?.name}</div>

      <div className="mt-4 flex flex-col gap-3">
        {fields.map((field) => (
          <ParamField
            key={field.key}
            id={`param-${field.key}`}
            label={field.label}
            value={(behavior.params as Record<string, unknown>)[field.key]}
            schema={field.schema}
            onChange={(value) =>
              dispatch({
                type: "setBehaviorParam",
                subjectId: selection.subjectId,
                behaviorId: behavior.id,
                key: field.key,
                value,
              })
            }
          />
        ))}
      </div>

      <div className="mt-auto flex justify-between border-t border-zinc-900 pt-3">
        <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-300">
          Duplicate
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: "removeBehavior",
              subjectId: selection.subjectId,
              behaviorId: behavior.id,
            })
          }
          className="text-[11px] text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>
    </aside>
  );
}
