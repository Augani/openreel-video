/**
 * Phone editor shell — stage 1 (structure): top bar, large preview with one play button, the
 * timeline, and a bottom tool bar whose tools open as bottom sheets. Rendered by EditorInterface
 * instead of its desktop/compact layout on phones (see phone.ts), after the editor is initialised,
 * so all editor services keep running. Later stages replace the timeline with a touch timeline and
 * fill the remaining sheets.
 */
import React, { Suspense, useState } from "react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useRouter } from "../../hooks/use-router";
import { Preview } from "../../components/editor/Preview";
import { Timeline } from "../../components/editor/Timeline";
import { Toolbar } from "../../components/editor/Toolbar";
import { ServerCaptionPanel } from "../ServerCaptionPanel";

const ChatPanel = React.lazy(() => import("../../components/editor/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })));

type SheetId = "edit" | "audio" | "text" | "captions" | "effects" | "transitions" | "assistant" | "more";

const TOOLS: { id: SheetId; label: string; icon: string }[] = [
  { id: "edit", label: "تعديل", icon: "✂️" },
  { id: "audio", label: "صوت", icon: "🎵" },
  { id: "text", label: "نص", icon: "T" },
  { id: "captions", label: "ترجمة", icon: "💬" },
  { id: "effects", label: "مؤثرات", icon: "✨" },
  { id: "transitions", label: "انتقالات", icon: "⇄" },
  { id: "assistant", label: "مساعد", icon: "🤖" },
  { id: "more", label: "المزيد", icon: "⋯" },
];

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const MobileEditor: React.FC = () => {
  const { navigate } = useRouter();
  const projectName = useProjectStore((s) => s.project.name);
  const duration = useProjectStore((s) => s.project.timeline?.duration ?? 0);
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const togglePlayback = useTimelineStore((s) => s.togglePlayback);
  const openModal = useUIStore((s) => s.openModal);
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const current = TOOLS.find((t) => t.id === sheet);

  return (
    <div className="hawsh-mobile flex h-full w-full flex-col overflow-hidden bg-bg text-fg" data-testid="hawsh-mobile-editor">
      {/* Export logic and its dialog live in the desktop Toolbar; keep it mounted but invisible. */}
      <div hidden aria-hidden><Toolbar /></div>

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3" dir="rtl" data-no-translate="">
        <button type="button" aria-label="رجوع" onClick={() => navigate("welcome")} className="grid h-10 w-10 place-items-center rounded-full text-lg">→</button>
        <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold" dir="auto">{projectName}</div>
        <button type="button" onClick={() => openModal("export")} className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-white">تصدير</button>
      </header>

      <section className="relative min-h-0 shrink-0 basis-[46%] bg-black" aria-label="المعاينة">
        <Preview hideControls />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-2 pt-6 text-white" dir="ltr">
          <span className="font-mono text-xs tabular-nums">{fmt(playhead)} / {fmt(duration)}</span>
          <button type="button" aria-label={playing ? "إيقاف" : "تشغيل"} onClick={togglePlayback} className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-lg text-black">
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="w-16" />
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden" aria-label="الخط الزمني">
        <Timeline />
      </section>

      <nav className="flex h-16 shrink-0 items-stretch border-t border-border bg-bg-1 pb-[env(safe-area-inset-bottom)]" dir="rtl" data-no-translate="" aria-label="أدوات المونتاج">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setSheet(t.id)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${sheet === t.id ? "text-primary" : "text-fg-2"}`}>
            <span className="text-lg leading-none" aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {current && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
          <div role="dialog" aria-modal="true" aria-label={current.label} onClick={(e) => e.stopPropagation()}
            className="flex max-h-[70%] min-h-[40%] flex-col rounded-t-2xl border-t border-border bg-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3" dir="rtl" data-no-translate="">
              <span className="text-sm font-bold">{current.label}</span>
              <button type="button" aria-label="إغلاق" onClick={() => setSheet(null)} className="grid h-8 w-8 place-items-center rounded-full text-lg">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {sheet === "captions" && <ServerCaptionPanel />}
              {sheet === "assistant" && (
                <div className="h-[55vh]">
                  <Suspense fallback={<div className="p-4 text-center text-xs text-fg-muted">…</div>}>
                    <ChatPanel onClose={() => setSheet(null)} />
                  </Suspense>
                </div>
              )}
              {sheet !== "captions" && sheet !== "assistant" && (
                <p className="py-8 text-center text-sm text-fg-muted" dir="rtl" data-no-translate="">هذه الأداة تُضاف في المرحلة القادمة.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
