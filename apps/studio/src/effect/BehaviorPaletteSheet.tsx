import { useMemo, useState } from "react";
import { Icon, type IconName } from "../icons";
import { listBehaviorsForSubject } from "./behaviors/registry";
import type { SubjectKind } from "./scene";

interface PaletteItem {
  id: string;
  label: string;
  iconName: IconName;
  thumbnailUrl: string;
}

export function BehaviorPaletteSheet({
  subjectKind,
  onAdd,
  onClose,
}: {
  subjectKind: SubjectKind;
  onAdd: (behaviorId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => listBehaviorsForSubject(subjectKind), [subjectKind]);
  const filtered = useMemo(
    () => all.filter((b) => b.label.toLowerCase().includes(query.trim().toLowerCase())),
    [all, query],
  );
  const presets: PaletteItem[] = filtered.filter((b) => b.kind === "preset");
  const atomics: PaletteItem[] = filtered.filter((b) => b.kind === "atomic");

  return (
    <div className="absolute inset-y-0 left-0 z-20 flex w-96 flex-col border-r border-zinc-800 bg-zinc-950 shadow-2xl">
      <header className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Add behavior</div>
          <div className="text-xs text-zinc-300">on {subjectKind.replace("_", " ")}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close palette"
          className="rounded p-1 text-zinc-500 hover:text-zinc-300"
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <input
        type="search"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="m-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-600"
      />
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <Section title="Effects" items={presets} onAdd={onAdd} />
        <Section title="Adjustments" items={atomics} onAdd={onAdd} />
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onAdd,
}: {
  title: string;
  items: PaletteItem[];
  onAdd: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            onClick={() => onAdd(item.id)}
            className="group flex flex-col rounded border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
          >
            <div className="mb-2 flex aspect-video w-full items-center justify-center rounded bg-zinc-950 text-zinc-700">
              <Icon name={item.iconName} size={20} />
            </div>
            <span className="text-xs text-zinc-200 group-hover:text-white">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
