import { useState } from "react";
import { useCommands } from "../commands";
import { cn } from "../lib/cn";
import type { View } from "../App";

interface Item {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

function MenuItem({ item, close }: { item: Item; close: () => void }) {
  if (item.sep) return <div className="my-1 h-px bg-zinc-800" />;
  return (
    <button
      disabled={item.disabled}
      onClick={() => { item.onClick?.(); close(); }}
      className="flex w-full items-center justify-between gap-6 rounded px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span>{item.label}</span>
      {item.shortcut && <span className="font-mono text-[9px] text-zinc-500">{item.shortcut}</span>}
    </button>
  );
}

export function Menubar({ view }: { view: View }) {
  const cmd = useCommands();
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);

  const menus: Record<string, Item[]> = {
    File: [
      { label: "New Effect", shortcut: "⌘N", onClick: cmd.newEffect },
      { label: "New Filter", shortcut: "⌘⇧N", onClick: cmd.newFilter },
      { label: "New Template", onClick: cmd.newTemplate },
      { label: "", sep: true },
      { label: "Back to hub", onClick: cmd.goHome },
    ],
    ...(view !== "hub" ? {
      Help: [
        { label: "Tutorials — start learning", onClick: cmd.openTutorials },
        { label: "Keyboard: ⌘Z undo · ⌘S save", disabled: true },
      ],
    } : {
      Help: [
        { label: "Tutorials — start learning", onClick: cmd.openTutorials },
      ],
    }),
  };

  return (
    <div className="relative flex">
      {Object.keys(menus).map((name) => (
        <div key={name} className="relative">
          <button
            onClick={() => setOpen((o) => (o === name ? null : name))}
            onMouseEnter={() => setOpen((o) => (o ? name : o))}
            className={cn("rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100", open === name && "bg-zinc-800 text-zinc-100")}
          >
            {name}
          </button>
          {open === name && (
            <div className="absolute left-0 top-[26px] z-50 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
              {menus[name].map((item, i) => <MenuItem key={i} item={item} close={close} />)}
            </div>
          )}
        </div>
      ))}
      {open && <div className="fixed inset-0 z-40" onClick={close} />}
    </div>
  );
}
