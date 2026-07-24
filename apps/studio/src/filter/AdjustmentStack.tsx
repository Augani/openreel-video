import { Icon } from "../icons";
import type { Behavior } from "../effect/scene";

export function AdjustmentStack({
  adjustments,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onMove,
}: {
  adjustments: Behavior[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-zinc-900 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Adjustments</span>
        <button type="button" onClick={onAdd} className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-700">
          + Add
        </button>
      </div>
      {adjustments.length === 0 ? (
        <p className="px-1 text-xs text-zinc-600">No adjustments yet.</p>
      ) : (
        adjustments.map((a, i) => (
          <div
            key={a.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
              if (Number.isFinite(from)) onMove(from, i);
            }}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
              selectedId === a.id ? "bg-blue-900/40 text-white" : "text-zinc-300 hover:bg-zinc-900"
            }`}
          >
            <Icon name="layers" size={12} />
            <button type="button" onClick={() => onSelect(a.id)} className="flex-1 truncate text-left">{a.name}</button>
            <button type="button" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.name}`} className="text-zinc-600 hover:text-red-400">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
