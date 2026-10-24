/**
 * Phone clip tools bar (stage 3): replaces the main tool bar while a clip is selected, CapCut-style.
 * Quick tools act at once (split, duplicate, delete); the rest open a small bottom sheet (trim,
 * speed, volume, silence cut). The work itself is in clip-tools.ts.
 */
import React, { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import type { Region } from "../silence-tools";
import {
  canCutAt, cutSilences, duplicate, findSilences, NOT_UNDER_PLAYHEAD, remove, selectedTarget, setSpeed, setVolume,
  silenceTotal, splitAt, SPEEDS, trimAt, type Target,
} from "./clip-tools";

type Sheet = "trim" | "speed" | "volume" | "silence";
interface Tool { id: string; label: string; icon: string; sheet?: Sheet; run?: (t: Target, time: number) => Promise<string | null> }

const TOOLS: Tool[] = [
  { id: "split", label: "تقسيم", icon: "⫼", run: splitAt },
  { id: "trim", label: "قص", icon: "✂️", sheet: "trim" },
  { id: "speed", label: "سرعة", icon: "⏩", sheet: "speed" },
  { id: "volume", label: "صوت", icon: "🔊", sheet: "volume" },
  { id: "silence", label: "قص السكتات", icon: "🤫", sheet: "silence" },
  { id: "duplicate", label: "تكرار", icon: "⧉", run: duplicate },
  { id: "delete", label: "حذف", icon: "🗑", run: remove },
];

/** Which tools fit the target: text has no media; still images have no speed or sound. */
export function toolsFor(t: Target): string[] {
  if (t.kind === "text-clip") return ["split", "trim", "delete"];
  if (t.trackType === "image") return ["split", "trim", "duplicate", "delete"];
  return TOOLS.map((x) => x.id);
}

const btn = "rounded-xl border border-border bg-bg-1 px-3 py-3 text-sm font-semibold active:bg-bg-2 disabled:opacity-40";

export const ClipTools: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const selected = useUIStore((s) => s.selectedItems);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const target = selectedTarget(project, selected);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasTarget = target !== null;
  useEffect(() => { if (!hasTarget) setSheet(null); }, [hasTarget]);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(id);
  }, [message]);

  if (!target) return null;
  const allowed = toolsFor(target);

  const run = async (fn: () => Promise<string | null>, after?: () => void) => {
    setBusy(true);
    try {
      const error = await fn();
      if (error) setMessage(error);
      else after?.();
    } finally { setBusy(false); }
  };

  const onTool = (tool: Tool) => {
    if (tool.sheet) { setSheet(tool.sheet); return; }
    if (tool.run) void run(() => tool.run!(target, playhead), tool.id === "delete" ? () => clearSelection() : undefined);
  };

  return (
    <>
      {message && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[95] rounded-xl bg-black/85 px-4 py-2 text-center text-sm text-white" dir="rtl" data-no-translate="" role="status">
          {message}
        </div>
      )}
      <nav className="flex h-16 shrink-0 items-stretch overflow-x-auto border-t border-border bg-bg-1 pb-[env(safe-area-inset-bottom)] [scrollbar-width:none]"
        dir="rtl" data-no-translate="" aria-label="أدوات اللقطة" data-testid="clip-tools">
        <button type="button" aria-label="إلغاء التحديد" onClick={() => clearSelection()} className="flex w-11 shrink-0 items-center justify-center border-e border-border text-lg">✕</button>
        {TOOLS.filter((t) => allowed.includes(t.id)).map((t) => (
          <button key={t.id} type="button" disabled={busy} onClick={() => onTool(t)}
            className={`flex min-w-[46px] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[10px] leading-tight disabled:opacity-40 ${t.id === "delete" ? "text-red-400" : "text-fg-2"}`}>
            <span className="text-lg leading-none" aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} dir="rtl" data-no-translate=""
            className="rounded-t-2xl border-t border-border bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">{TOOLS.find((t) => t.sheet === sheet)?.label}</span>
              <button type="button" aria-label="إغلاق" onClick={() => setSheet(null)} className="grid h-8 w-8 place-items-center rounded-full text-lg">✕</button>
            </div>
            {sheet === "trim" && (
              <div className="space-y-2">
                <p className="text-xs text-fg-muted">{canCutAt(target, playhead) ? "يقص عند المؤشر الأبيض." : NOT_UNDER_PLAYHEAD}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={btn} disabled={busy || !canCutAt(target, playhead)}
                    onClick={() => void run(() => trimAt(target, playhead, "start"), () => setSheet(null))}>احذف ما قبل المؤشر</button>
                  <button type="button" className={btn} disabled={busy || !canCutAt(target, playhead)}
                    onClick={() => void run(() => trimAt(target, playhead, "end"), () => setSheet(null))}>احذف ما بعد المؤشر</button>
                </div>
              </div>
            )}
            {sheet === "speed" && target.kind === "clip" && (
              <div className="grid grid-cols-5 gap-2" dir="ltr">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => void run(() => setSpeed(target.clip, s))}
                    className={`${btn} ${Math.abs((target.clip.speed ?? 1) - s) < 0.001 ? "border-primary text-primary" : ""}`}>{s}×</button>
                ))}
              </div>
            )}
            {sheet === "volume" && target.kind === "clip" && <VolumeControl key={target.id} clipId={target.id} volume={target.clip.volume ?? 1} />}
            {sheet === "silence" && target.kind === "clip" && <SilenceControl key={target.id} clipId={target.id} onDone={() => setSheet(null)} />}
          </div>
        </div>
      )}
    </>
  );
};

/** Volume 0–200%; committed when the finger lifts so a drag is one undo step. */
const VolumeControl: React.FC<{ clipId: string; volume: number }> = ({ clipId, volume }) => {
  const [value, setValue] = useState(Math.round(volume * 100));
  useEffect(() => setValue(Math.round(volume * 100)), [volume]);
  const commit = (v: number) => { if (Math.abs(v / 100 - volume) > 0.001) void setVolume(clipId, v / 100); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" dir="ltr">
        <input type="range" min={0} max={200} step={1} value={value} aria-label="مستوى الصوت" className="flex-1 accent-primary"
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <span className="w-12 text-end font-mono text-sm tabular-nums">{value}%</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btn} onClick={() => { setValue(0); commit(0); }}>كتم</button>
        <button type="button" className={btn} onClick={() => { setValue(100); commit(100); }}>100%</button>
      </div>
    </div>
  );
};

/** Finds the pauses first and says how much will go, then cuts on confirmation. */
const SilenceControl: React.FC<{ clipId: string; onDone: () => void }> = ({ clipId, onDone }) => {
  const [state, setState] = useState<{ phase: "finding" } | { phase: "found"; regions: Region[] } | { phase: "error"; text: string } | { phase: "cutting" }>({ phase: "finding" });
  useEffect(() => {
    let live = true;
    void findSilences(clipId).then((res) => {
      if (!live) return;
      setState("error" in res ? { phase: "error", text: res.error } : { phase: "found", regions: res.regions });
    });
    return () => { live = false; };
  }, [clipId]);

  if (state.phase === "finding") return <p className="py-4 text-center text-sm text-fg-muted">أدوّر على السكتات…</p>;
  if (state.phase === "cutting") return <p className="py-4 text-center text-sm text-fg-muted">أقص السكتات…</p>;
  if (state.phase === "error") return <p className="py-4 text-center text-sm text-red-400">{state.text}</p>;
  if (!state.regions.length) return <p className="py-4 text-center text-sm text-fg-muted">ما لقيت سكتات في هذه اللقطة.</p>;
  const { regions } = state;
  return (
    <div className="space-y-3">
      <p className="text-sm">لقيت {regions.length} سكتة، مجموعها {silenceTotal(regions)} ثانية.</p>
      <button type="button" className={`${btn} w-full border-primary bg-primary text-white`}
        onClick={() => { setState({ phase: "cutting" }); void cutSilences(clipId, regions).then((err) => (err ? setState({ phase: "error", text: err }) : onDone())); }}>
        قصها
      </button>
    </div>
  );
};
