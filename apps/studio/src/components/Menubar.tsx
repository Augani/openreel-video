import { useState } from "react";
import type { LanguagePreference } from "@openreel/i18n";
import { useLanguage, useT } from "@openreel/i18n/react";
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
  const t = useT();
  if (item.sep) return <div className="my-1 h-px bg-zinc-800" />;
  return (
    <button
      disabled={item.disabled}
      onClick={() => { item.onClick?.(); close(); }}
      className="flex w-full items-center justify-between gap-6 rounded px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span>{t(item.label)}</span>
      {item.shortcut && <span className="font-mono text-[9px] text-zinc-500">{item.shortcut}</span>}
    </button>
  );
}

export function Menubar({ view }: { view: View }) {
  const cmd = useCommands();
  const t = useT();
  const { preference, setPreference } = useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);

  const languageItem = (value: LanguagePreference, label: string): Item => ({
    label: `${preference === value ? "✓ " : ""}${label}`,
    onClick: () => setPreference(value),
  });

  const menus: Record<string, Item[]> = {
    File: [
      { label: t("New Effect"), shortcut: "⌘N", onClick: cmd.newEffect },
      { label: t("New Filter"), shortcut: "⌘⇧N", onClick: cmd.newFilter },
      { label: t("New Template"), onClick: cmd.newTemplate },
      { label: "", sep: true },
      { label: t("Back to hub"), onClick: cmd.goHome },
    ],
    Language: [
      languageItem("system", t("Follow system")),
      languageItem("en", "English"),
      languageItem("zh-CN", "简体中文"),
    ],
    ...(view !== "hub" ? {
      Help: [
        { label: t("Tutorials — start learning"), onClick: cmd.openTutorials },
        { label: t("Keyboard: ⌘Z undo · ⌘S save"), disabled: true },
      ],
    } : {
      Help: [
        { label: t("Tutorials — start learning"), onClick: cmd.openTutorials },
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
            {t(name)}
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
