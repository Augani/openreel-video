/**
 * "Director's Eyes library" in the Media panel: browse the user's generations and references and add
 * them to the project, and save the last export to "My references". Only active when the editor was
 * opened from hawsh-khalifa.com (see session.ts); otherwise a link explains how.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Check, Film, Image as ImageIcon, Loader2, LogOut, Save, X } from "lucide-react";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";
import { HAWSH_EDITOR_PAGE } from "./config";
import { itemToFile, listLibrary, saveExportToLibrary } from "./api";
import type { HawshItem, HawshKind, HawshSource } from "./library";
import { clearLastExport, useLastExport } from "./lastExport";
import { signOutHawsh, useHawshStore } from "./session";

const btn = "flex w-full items-center justify-center gap-[7px] rounded-[9px] border border-border bg-bg p-[10px] text-[13px] font-medium text-fg-2 disabled:opacity-50";
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-[12px] font-medium ${on ? "border-primary bg-bg-2 text-fg" : "border-border text-fg-2"}`;

export const HawshLibraryButton: React.FC = () => {
  const status = useHawshStore((s) => s.status);
  const error = useHawshStore((s) => s.error);
  const hasExport = useLastExport((s) => !!s.blob);
  const [open, setOpen] = useState(false);

  if (status === "connecting") {
    return <div className={`${btn} mb-[18px]`}><Loader2 size={15} className="animate-spin" aria-hidden />Connecting to Director's Eyes…</div>;
  }
  if (status !== "ready") {
    return (
      <a href={HAWSH_EDITOR_PAGE} target="_blank" rel="noopener noreferrer" className={`${btn} mb-[18px]`} title={error ?? undefined}>
        <ImageIcon size={15} aria-hidden />
        {error ? "Sign-in expired — reopen from Director's Eyes" : "Use your Director's Eyes library"}
      </a>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn} mb-[18px]`}>
        <ImageIcon size={15} aria-hidden />
        Director's Eyes library
        {hasExport && <span className="ml-1 h-2 w-2 rounded-full bg-primary" aria-label="An export is ready to save" />}
      </button>
      {open && <HawshLibraryDialog onClose={() => setOpen(false)} />}
    </>
  );
};

const HawshLibraryDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const email = useHawshStore((s) => s.email);
  const importMedia = useProjectStore((s) => s.importMedia);
  const [source, setSource] = useState<HawshSource>("generations");
  const [kind, setKind] = useState<HawshKind>("video");
  const [items, setItems] = useState<HawshItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    setLoadError(null);
    try { setItems(await listLibrary(source, kind)); } catch (e) { setLoadError(e instanceof Error ? e.message : "Couldn't load your library."); }
  }, [source, kind]);
  useEffect(() => { void load(); setSelected(new Set()); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const add = async () => {
    const picked = (items ?? []).filter((i) => selected.has(i.key));
    if (!picked.length) return;
    setAdding(true);
    let ok = 0;
    const failed: string[] = [];
    for (const item of picked) {
      try {
        const res = await importMedia(await itemToFile(item));
        if (res.success) ok++; else failed.push(item.title);
      } catch {
        failed.push(item.title);
      }
    }
    setAdding(false);
    if (ok) toast.success(ok === 1 ? "Added to the project" : `${ok} items added to the project`);
    if (failed.length) toast.error("Some items couldn't be added", failed.join(", "));
    if (!failed.length) onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Director's Eyes library"
        className="flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-fg">Director's Eyes library</div>
            {email && <div className="truncate text-[11px] text-fg-2">{email}</div>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { void signOutHawsh(); onClose(); }} className="rounded-lg p-2 text-fg-2 hover:bg-hover" title="Sign out of the editor" aria-label="Sign out of the editor"><LogOut size={16} /></button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-fg-2 hover:bg-hover" aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        <SaveExportBar />

        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <button type="button" className={chip(source === "generations")} aria-pressed={source === "generations"} onClick={() => setSource("generations")}>My generations</button>
          <button type="button" className={chip(source === "references")} aria-pressed={source === "references"} onClick={() => setSource("references")}>My references</button>
          <span className="mx-1 h-4 w-px bg-border" />
          <button type="button" className={chip(kind === "video")} aria-pressed={kind === "video"} onClick={() => setKind("video")}><Film size={12} className="mr-1 inline" />Videos</button>
          <button type="button" className={chip(kind === "image")} aria-pressed={kind === "image"} onClick={() => setKind("image")}><ImageIcon size={12} className="mr-1 inline" />Images</button>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto px-4 py-3">
          {loadError ? (
            <div className="py-10 text-center text-[13px] text-fg-2">{loadError} <button type="button" className="underline" onClick={() => void load()}>Retry</button></div>
          ) : !items ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-fg-2" aria-label="Loading" /></div>
          ) : !items.length ? (
            <div className="py-10 text-center text-[13px] text-fg-2">Nothing here yet.</div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((it) => {
                const on = selected.has(it.key);
                return (
                  <li key={it.key}>
                    <button type="button" onClick={() => toggle(it.key)} aria-pressed={on} title={it.title}
                      className={`relative block aspect-square w-full overflow-hidden rounded-xl border-2 bg-black ${on ? "border-primary" : "border-transparent"}`}>
                      {it.thumb
                        ? <img src={it.thumb} alt={it.title} crossOrigin="anonymous" loading="lazy" className="h-full w-full object-cover" />
                        : <span className="flex h-full w-full items-center justify-center text-fg-2">{it.kind === "video" ? <Film size={22} /> : <ImageIcon size={22} />}</span>}
                      {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white"><Check size={13} /></span>}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-left text-[10.5px] text-white">{it.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-[12px] text-fg-2">{selected.size ? `${selected.size} selected` : "Tap items to select them"}</span>
          <button type="button" onClick={() => void add()} disabled={!selected.size || adding}
            className="flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">
            {adding && <Loader2 size={14} className="animate-spin" />}Add to project
          </button>
        </div>
      </div>
    </div>
  );
};

/** "Save last export to My references" — shown after a browser export while signed in. */
const SaveExportBar: React.FC = () => {
  const { blob, filename } = useLastExport();
  const [saving, setSaving] = useState(false);
  if (!blob || !filename) return null;
  const save = async () => {
    setSaving(true);
    try {
      const r = await saveExportToLibrary(blob, filename);
      toast.success(r.reused ? "Already in your references" : "Saved to your references", "Find it in Director's Eyes → My references.");
      clearLastExport();
    } catch (e) {
      toast.error("Couldn't save the export", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-xl border border-primary bg-bg-2 px-3 py-2">
      <span className="min-w-0 truncate text-[12.5px] text-fg">Last export: <b>{filename}</b> ({(blob.size / 1024 / 1024).toFixed(1)} MB)</span>
      <button type="button" onClick={() => void save()} disabled={saving}
        className="flex shrink-0 items-center gap-1.5 rounded-[9px] bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save to my library
      </button>
    </div>
  );
};
