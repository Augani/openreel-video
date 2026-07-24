import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { listDrafts, type DraftRecord } from "./drafts";

export function RecentProjects({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);

  useEffect(() => {
    listDrafts().then(setDrafts).catch(() => setDrafts([]));
  }, []);

  return (
    <div className="grid grid-cols-4 gap-3">
      {drafts.slice(0, 7).map((d) => (
        <button
          type="button"
          key={d.id}
          onClick={() => onOpen(d.id)}
          className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-left hover:border-zinc-600"
        >
          <div className="mb-2 aspect-video w-full overflow-hidden rounded bg-zinc-950">
            {d.thumbnailDataUrl ? (
              <img src={d.thumbnailDataUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-700">
                <Icon name="image" size={20} />
              </div>
            )}
          </div>
          <div className="text-xs text-zinc-200">{d.name}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">{d.kind}</div>
        </button>
      ))}
      <button
        type="button"
        onClick={onNew}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 p-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
      >
        <Icon name="plus" size={18} />
        <span className="mt-2 text-xs">New</span>
      </button>
    </div>
  );
}
