/**
 * Auto captions on the site's server (Hawsh Khalifa build) — replaces OpenReel's in-browser Whisper
 * panel (owner's decision: server only, no model downloads). Same output as before: single-line
 * editable text clips on the Captions track via addSubtitle, so CaptionEditorPanel keeps working.
 */
import React, { useCallback, useEffect, useState } from "react";
import { SUBTITLE_STYLE_PRESETS, type TranscriptionSegment } from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import { AlertCircle, Languages, Loader2, Sparkles } from "@/icons/lucide-compat";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { HAWSH_EDITOR_PAGE } from "./config";
import { useHawshStore } from "./session";
import { loadTranscribePrice, transcribeClip, transcribePoints, TRANSCRIBE_DEFAULT_POINTS_PER_MIN } from "./transcribe";

const STYLES = [
  { value: "default", label: "افتراضي" },
  { value: "modern", label: "عصري" },
  { value: "bold", label: "عريض" },
  { value: "cinematic", label: "سينمائي" },
  { value: "minimal", label: "بسيط" },
];
const LANGUAGES = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
  { value: "auto", label: "اكتشاف تلقائي" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "tr", label: "Türkçe" },
  { value: "ur", label: "اردو" },
  { value: "hi", label: "हिन्दी" },
];

interface Props { clipId?: string; maxWordsPerLine?: number }

export const ServerCaptionPanel: React.FC<Props> = ({ clipId, maxWordsPerLine = 5 }) => {
  const signedIn = useHawshStore((s) => s.status === "ready");
  const getClip = useProjectStore((s) => s.getClip);
  const getMediaItem = useProjectStore((s) => s.getMediaItem);
  const addSubtitle = useProjectStore((s) => s.addSubtitle);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const resolvedId = clipId ?? selectedItems.find((i) => i.type === "clip")?.id ?? "";
  const clip = getClip(resolvedId);
  const media = clip ? getMediaItem(clip.mediaId) : undefined;
  const canTranscribe = !!clip && !!media && (media.type === "video" || media.type === "audio");

  const [language, setLanguage] = useState("ar");
  const [style, setStyle] = useState("default");
  const [price, setPrice] = useState(TRANSCRIBE_DEFAULT_POINTS_PER_MIN);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);

  useEffect(() => { if (signedIn) void loadTranscribePrice().then(setPrice); }, [signedIn]);

  const clipSeconds = clip ? clip.duration * Math.max(clip.speed ?? 1, 0.01) : 0;

  const transcribe = useCallback(async () => {
    if (!clip || !media) return;
    setBusy(true); setError(null); setSegments([]); setStatus("جارٍ التجهيز…");
    try {
      const res = await transcribeClip(clip, media, language, maxWordsPerLine, (_f, message) => setStatus(message));
      setSegments(res.segments);
      setStatus(`جاهزة — خُصم ${res.points} نقطة (${res.minutes} دقيقة).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التفريغ.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [clip, media, language, maxWordsPerLine]);

  const addToTimeline = useCallback(async () => {
    if (!clip || !segments.length) return;
    const preset = SUBTITLE_STYLE_PRESETS[style] ?? SUBTITLE_STYLE_PRESETS.default;
    for (const s of segments) {
      await addSubtitle(
        { id: `hawsh-${crypto.randomUUID()}`, text: s.text, startTime: s.startTime, endTime: s.endTime, style: preset },
        { captionSource: "whisper", captionSourceClipId: clip.id, captionMaxWordsPerLine: maxWordsPerLine },
      );
    }
    setStatus(`أُضيف ${segments.length} سطر ترجمة إلى مسار Captions.`);
    setSegments([]);
  }, [addSubtitle, clip, maxWordsPerLine, segments, style]);

  if (!signedIn) {
    return (
      <div data-no-translate="" dir="rtl"><Card variant="muted" padding={3} className="space-y-2">
        <Text type="supporting" className="block text-[11px] text-fg">الترجمة التلقائية تعمل بنقاط عيون المخرج.</Text>
        <a href={HAWSH_EDITOR_PAGE} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline">
          افتح المحرر من عيون المخرج
        </a>
      </Card></div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3" data-no-translate="" dir="rtl">
      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[10px]">لغة الكلام</Text>
          </div>
          <Selector label="لغة الكلام" isLabelHidden size="sm" width={140} value={language} onChange={setLanguage} isDisabled={busy}
            options={LANGUAGES} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[10px]">شكل الترجمة</Text>
          <Selector label="شكل الترجمة" isLabelHidden size="sm" width={140} value={style} onChange={setStyle} isDisabled={busy}
            options={STYLES} />
        </div>
        <Text type="supporting" color="secondary" className="block text-[9px] leading-relaxed">
          {price} نقطة لكل دقيقة صوت بدأت{canTranscribe ? ` — هذا المقطع: ${transcribePoints(clipSeconds, price)} نقطة` : ""}. التفريغ في سيرفر عيون المخرج، ولا يُنزَّل شيء على جهازك.
        </Text>
      </Card>

      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <Text type="supporting" className="text-[10px] text-red-400">{error}</Text>
        </Card>
      )}

      {(busy || status) && (
        <Card variant="muted" padding={3} className="flex items-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin text-primary" aria-hidden />}
          <Text type="supporting" color="secondary" className="text-[10px]">{status}</Text>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {segments.map((s, i) => (
              <Card key={`${s.startTime}-${i}`} variant="muted" padding={2} className="text-[10px]">
                <span className="font-mono text-fg-muted">{s.startTime.toFixed(1)}s</span>
                <span className="ms-2 text-fg" dir="auto">{s.text}</span>
              </Card>
            ))}
          </div>
          <Button label={`أضف ${segments.length} سطر كنص قابل للتعديل`} variant="primary" size="sm" onClick={() => void addToTimeline()} className="w-full justify-center" />
        </div>
      )}

      <Button
        label={busy ? "جارٍ التفريغ…" : "فرّغ المقطع المحدد"}
        icon={busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
        variant="primary" size="md" onClick={() => void transcribe()} isDisabled={!canTranscribe || busy}
        className="w-full justify-center"
      />
      {!canTranscribe && (
        <Text type="supporting" color="secondary" className="block text-center text-[9px]">حدّد مقطع فيديو أو صوت أولاً.</Text>
      )}
    </div>
  );
};

export default ServerCaptionPanel;
