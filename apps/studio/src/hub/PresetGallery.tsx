import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { listBehaviors, registerAllBehaviors } from "../effect/behaviors/registry";

registerAllBehaviors();

type Filter = "all" | "subject" | "filter";

export function PresetGallery({ onOpen }: { onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const presets = useMemo(() => listBehaviors().filter((b) => b.kind === "preset"), []);
  const visible = presets.filter((p) => {
    if (filter === "all") return true;
    if (filter === "subject") return p.acceptsSubjects.some((k) => k !== "full_frame");
    return p.acceptsSubjects.includes("full_frame");
  });

  return (
    <div>
      <div className="mb-3 flex gap-1 text-xs">
        {(["all", "subject", "filter"] as Filter[]).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-3 py-1 capitalize ${filter === f ? "border-blue-500 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-3">
        {visible.map((preset) => (
          <button
            type="button"
            key={preset.id}
            onClick={() => onOpen(preset.id)}
            className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
          >
            <div className="mb-2 flex aspect-video w-full items-center justify-center rounded bg-zinc-950 text-zinc-700">
              <Icon name={preset.iconName} size={20} />
            </div>
            <span className="text-xs text-zinc-200">{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
