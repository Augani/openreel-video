import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAPTION_EXPORT_FORMATS,
  CAPTION_FORMAT_INFO,
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  cutDuration,
  SPEAKER_PALETTE,
  defaultSpeakerName,
  findFillerWords,
  findSpeakerProfile,
  type SpeakerPosition,
  type SpeakerProfile,
  findPauses,
  listCaptionTracks,
  listSpeakers,
  mergeTimeRanges,
  searchTranscript,
  wordIndexAt,
  wordRange,
  type CaptionExportFormat,
  type CaptionFormatIssue,
  type TranscriptWord,
} from "@openreel/core";
import {
  Button,
  Checkbox,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { toast } from "../../stores/notification-store";
import {
  cutTranscriptRanges,
  exportCaptionBytes,
  importCaptionBytes,
  renameTranscriptSpeaker,
  setCaptionSpeaker,
  setCaptionTrackInPicture,
  updateSpeakerProfile,
} from "../../services/transcript-commands";
import { diarizeCaptions } from "../../services/diarization";
import { captionMetadataNotes } from "../../services/export-metadata";
import { CaptionTranslateSection } from "./CaptionTranslateSection";
import { formatFrameTimecode } from "../../utils/frame-timecode";

/** Programme start timecode written into / read out of broadcast caption files. */
const PROGRAMME_STARTS = [
  { value: "0", label: "00:00:00:00" },
  { value: "3600", label: "01:00:00:00" },
  { value: "36000", label: "10:00:00:00" },
] as const;

/** Frame rate to write SCC / STL timecodes at: the project's when the format supports it. */
function broadcastFrameRate(format: CaptionExportFormat | "import", fps: number): number | undefined {
  // 29.97 and 30 differ by 0.03: match tightly so a true 30 fps project is not read as NTSC.
  const near = (target: number) => Math.abs(fps - target) < 0.01;
  if (format === "stl") return near(25) ? 25 : near(29.97) || near(30) ? fps : 25;
  return [24, 25, 29.97, 30].find(near);
}

/** Parse errors of an import as panel notes (one per skipped cue / block). */
function skippedNotes(errors: readonly string[] | undefined): CaptionFormatIssue[] {
  return (errors ?? []).slice(0, 50).map((message) => ({ severity: "warning" as const, code: "import-skipped", message: `Skipped: ${message}` }));
}

/** Radix Select items cannot have an empty value; the default caption track ("") uses this. */
const DEFAULT_TRACK_VALUE = "__default__";

/** Used only until a speaker has a stored profile (same order as the core palette). */
const SPEAKER_FALLBACK = SPEAKER_PALETTE;

const seconds = (value: number) => `${(Math.round(value * 100) / 100).toFixed(2)}s`;

interface WordProps {
  word: TranscriptWord;
  active: boolean;
  selected: boolean;
  matched: boolean;
  removing: boolean;
}

const Word = memo(function Word({ word, active, selected, matched, removing }: WordProps) {
  return (
    <span
      data-word-index={word.index}
      data-word-start={word.start}
      data-word-end={word.end}
      data-active={active || undefined}
      data-selected={selected || undefined}
      className={[
        "cursor-pointer select-none rounded-[3px] px-[2px] py-[1px] transition-colors",
        active ? "bg-accent text-white" : "hover:bg-bg-3",
        selected && !active ? "bg-accent-soft text-fg outline outline-1 outline-accent/60" : "",
        matched && !selected && !active ? "bg-yellow-500/30" : "",
        removing && !active ? "line-through decoration-red-400/80 text-fg-3" : "",
        word.estimated && !active ? "text-fg-2" : "",
      ].join(" ")}
    >
      {word.text}
    </span>
  );
});

function SpeakerLabel({ name, color, onRename }: { name?: string; color?: string; onRename: (from: string, to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");
  useEffect(() => setDraft(name ?? ""), [name]);
  if (!name) return null;
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(name, draft.trim());
    else setDraft(name);
  };
  return editing ? (
    <Input
      autoFocus
      aria-label={`Rename speaker ${name}`}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      className="h-6 w-32 px-1.5 text-[11px]"
    />
  ) : (
    <button
      type="button"
      title="Rename speaker"
      aria-label={`Speaker ${name}. Click to rename`}
      onClick={() => setEditing(true)}
      className="flex select-none items-center gap-1 rounded px-1 text-[11px] font-semibold text-accent hover:bg-bg-3"
      style={color ? { color } : undefined}
    >
      {color && <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {name}
    </button>
  );
}

const NEW_SPEAKER = "__new__";
const NO_SPEAKER = "__none__";

function SpeakerReassign({
  current,
  names,
  onAssign,
}: {
  current?: string;
  names: string[];
  onAssign: (speaker: string) => void;
}) {
  return (
    <select
      aria-label="Reassign speaker for this passage"
      title="Reassign this passage to another speaker"
      value={current ?? NO_SPEAKER}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (v === NEW_SPEAKER) {
          let n = names.length + 1;
          while (names.includes(defaultSpeakerName(n))) n++;
          onAssign(defaultSpeakerName(n));
        } else onAssign(v === NO_SPEAKER ? "" : v);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="h-5 max-w-[88px] rounded border border-border bg-bg-2 px-0.5 text-[10px] text-fg-3 hover:text-fg"
    >
      <option value={NO_SPEAKER}>No speaker</option>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={NEW_SPEAKER}>New speaker</option>
    </select>
  );
}

const POSITION_AUTO = "auto";

function SpeakerRow({
  profile,
  others,
  onRename,
}: {
  profile: SpeakerProfile;
  /** Names of the other speakers this one can be merged into. */
  others: readonly string[];
  onRename: (from: string, to: string) => void;
}) {
  const report = (outcome: { success: boolean; message?: string }) => {
    if (!outcome.success) toast.error("Speaker update failed", outcome.message);
  };
  return (
    <li className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={`Colour for ${profile.name}`}
        title="Speaker and caption colour"
        value={/^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : "#ffffff"}
        onChange={(e) => void updateSpeakerProfile(profile.name, { color: e.currentTarget.value }).then(report)}
        className="size-5 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
      />
      <span className="min-w-0 flex-1">
        <SpeakerLabel name={profile.name} onRename={onRename} />
      </span>
      <select
        aria-label={`Caption position for ${profile.name}`}
        title="Where this speaker's captions sit"
        value={profile.position ?? POSITION_AUTO}
        onChange={(e) => {
          const v = e.currentTarget.value;
          void updateSpeakerProfile(profile.name, {
            position: v === POSITION_AUTO ? undefined : (v as SpeakerPosition),
          }).then(report);
        }}
        className="h-6 rounded border border-border bg-bg-2 px-1 text-[10px] text-fg-2"
      >
        <option value={POSITION_AUTO}>Position: as is</option>
        <option value="top">Top</option>
        <option value="center">Centre</option>
        <option value="bottom">Bottom</option>
      </select>
      {others.length > 0 && (
        <select
          aria-label={`Merge ${profile.name} into another speaker`}
          title="Merge this speaker into another (one undo step)"
          value=""
          onChange={(e) => {
            const into = e.currentTarget.value;
            if (into) onRename(profile.name, into);
          }}
          className="h-6 rounded border border-border bg-bg-2 px-1 text-[10px] text-fg-2"
        >
          <option value="">Merge into...</option>
          {others.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

type Tool = "fillers" | "pauses" | "translate" | null;

export function TranscriptPanel() {
  const subtitles = useProjectStore((s) => s.project.timeline.subtitles);
  const frameRate = useProjectStore((s) => s.project.settings.frameRate);
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const seekTo = useTimelineStore((s) => s.seekTo);

  const tracks = useMemo(() => listCaptionTracks(subtitles), [subtitles]);
  const [trackId, setTrackId] = useState<string>("");
  const activeTrack = tracks.some((t) => t.id === trackId) ? trackId : (tracks[0]?.id ?? "");
  const trackHidden = useMemo(
    () => !subtitles.some((c) => (c.captionTrackId ?? "") === activeTrack && !c.hidden),
    [subtitles, activeTrack],
  );
  const transcript = useMemo(
    () => buildTranscript(subtitles, tracks.length > 1 ? { captionTrackId: activeTrack } : {}),
    [subtitles, tracks.length, activeTrack],
  );
  const speakers = useMemo(() => listSpeakers(subtitles), [subtitles]);
  const storedProfiles = useProjectStore((s) => s.project.speakers);
  const profiles = useMemo<SpeakerProfile[]>(
    () => speakers.map((name, i) => findSpeakerProfile(storedProfiles, name) ?? { name, color: SPEAKER_FALLBACK[i % SPEAKER_FALLBACK.length] }),
    [speakers, storedProfiles],
  );
  const [detect, setDetect] = useState<{ progress: number; message: string } | null>(null);
  const [speakerCount, setSpeakerCount] = useState("auto");
  const [speakersOpen, setSpeakersOpen] = useState(false);
  const detectAbort = useRef<AbortController | null>(null);
  useEffect(() => () => detectAbort.current?.abort(), []);
  const detectSpeakers = async () => {
    const controller = new AbortController();
    detectAbort.current = controller;
    setDetect({ progress: 0, message: "Reading audio…" });
    try {
      const outcome = await diarizeCaptions({
        speakerCount: speakerCount === "auto" ? undefined : Number(speakerCount),
        signal: controller.signal,
        onProgress: (progress, message) => setDetect({ progress, message }),
      });
      if (outcome.success)
        toast.success(
          `${outcome.speakers} speaker${outcome.speakers === 1 ? "" : "s"} found`,
          "Voice matching is approximate, so check the labels. Rename, recolour or reassign a passage below. Undo restores the previous labels.",
        );
      else toast.error("Speaker detection failed", outcome.message);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error("Speaker detection failed", error instanceof Error ? error.message : undefined);
    } finally {
      detectAbort.current = null;
      setDetect(null);
    }
  };
  const { words, sentences } = transcript;

  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchTranscript(words, query), [words, query]);
  const matchedWords = useMemo(() => {
    const set = new Set<number>();
    for (const m of matches) for (let i = m.wordStart; i <= m.wordEnd; i++) set.add(i);
    return set;
  }, [matches]);
  const [matchCursor, setMatchCursor] = useState(0);

  const [selection, setSelection] = useState<{ anchor: number; head: number } | null>(null);
  const selFirst = selection ? Math.min(selection.anchor, selection.head) : -1;
  const selLast = selection ? Math.max(selection.anchor, selection.head) : -1;
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<Tool>(null);
  const [fillerText, setFillerText] = useState(DEFAULT_FILLER_PHRASES.join(", "));
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [pauseMin, setPauseMin] = useState("0.8");
  const [exportFormat, setExportFormat] = useState<CaptionExportFormat>("vtt");
  const [programmeStart, setProgrammeStart] = useState<string>("0");
  const [exportSpeakers, setExportSpeakers] = useState(true);
  const [exportNotes, setExportNotes] = useState<CaptionFormatIssue[]>([]);
  const [language, setLanguage] = useState("");
  const [ccChannel, setCcChannel] = useState<"1" | "2" | "3" | "4">("1");
  const fileRef = useRef<HTMLInputElement>(null);

  const fillers = useMemo(
    () =>
      findFillerWords(
        words,
        fillerText
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    [words, fillerText],
  );
  const chosenFillers = fillers.filter((f) => !skipped.has(f.wordStart));
  const pauseSeconds = Number(pauseMin);
  const pauses = useMemo(
    () => (Number.isFinite(pauseSeconds) && pauseSeconds >= 0 ? findPauses(words, pauseSeconds) : []),
    [words, pauseSeconds],
  );

  const removing = useMemo(() => {
    const set = new Set<number>();
    if (tool === "fillers")
      for (const f of chosenFillers) for (let i = f.wordStart; i <= f.wordEnd; i++) set.add(i);
    return set;
  }, [tool, chosenFillers]);

  // Select the word index (an integer), not the playhead, so playback only
  // re-renders the panel when the spoken word changes, not on every tick.
  const activeIndex = useTimelineStore(
    useCallback(
      (s: { playheadPosition: number }) => {
        const i = wordIndexAt(words, s.playheadPosition);
        return i >= 0 && s.playheadPosition <= words[i].end + 1e-6 ? i : -1;
      },
      [words],
    ),
  );

  // Word indices are only valid for this exact transcript: drop the selection
  // and the unchecked fillers when the captions change (undo, import, rename,
  // another caption track), so Delete can never cut words the user did not pick.
  useEffect(() => {
    setSelection(null);
    setSkipped(new Set());
  }, [words]);

  // Follow playback: keep the spoken word in view.
  useEffect(() => {
    if (!playing || activeIndex < 0) return;
    rootRef.current
      ?.querySelector(`[data-word-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, playing]);

  const jumpToMatch = useCallback(
    (cursor: number) => {
      if (!matches.length) return;
      const next = ((cursor % matches.length) + matches.length) % matches.length;
      setMatchCursor(next);
      const m = matches[next];
      setSelection({ anchor: m.wordStart, head: m.wordEnd });
      seekTo(words[m.wordStart].start);
      rootRef.current
        ?.querySelector(`[data-word-index="${m.wordStart}"]`)
        ?.scrollIntoView({ block: "center" });
    },
    [matches, seekTo, words],
  );

  const sentenceOf = (index: number) =>
    sentences.find((s) => index >= s.wordStart && index < s.wordEnd);

  const onWordPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-word-index]");
    if (!el || event.button !== 0) return;
    const index = Number(el.dataset.wordIndex);
    rootRef.current?.focus();
    if (event.shiftKey && selection) {
      setSelection({ anchor: selection.anchor, head: index });
      return;
    }
    dragging.current = true;
    setSelection({ anchor: index, head: index });
    seekTo(words[index].start);
  };
  const onWordDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-word-index]");
    if (!el) return;
    const s = sentenceOf(Number(el.dataset.wordIndex));
    if (s) setSelection({ anchor: s.wordStart, head: s.wordEnd - 1 });
  };
  const onWordPointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || event.buttons !== 1) return;
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-word-index]");
    if (el) setSelection((s) => (s ? { ...s, head: Number(el.dataset.wordIndex) } : s));
  };
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const selectedRange = useMemo(
    () =>
      selection && selLast < words.length ? wordRange(transcript, selection.anchor, selection.head) : null,
    [selection, selLast, words.length, transcript],
  );
  const selectedCount = selectedRange ? selLast - selFirst + 1 : 0;

  const report = (label: string, outcome: { success: boolean; message?: string; removed?: number }) => {
    if (outcome.success)
      toast.success(label, outcome.removed !== undefined ? `Removed ${seconds(outcome.removed)}` : undefined);
    else toast.error(`${label} failed`, outcome.message);
  };

  const deleteSelection = () => {
    if (!selectedRange) return;
    const outcome = cutTranscriptRanges([selectedRange], "Delete transcript text");
    report("Deleted transcript text", outcome);
    if (outcome.success) setSelection(null);
  };

  const applyFillers = () => {
    const ranges = chosenFillers.map((f) => ({ start: f.start, end: f.end }));
    const outcome = cutTranscriptRanges(ranges, "Remove filler words");
    report(`Removed ${chosenFillers.length} filler words`, outcome);
    if (outcome.success) {
      setTool(null);
      setSkipped(new Set());
    }
  };

  const applyPauses = () => {
    const ranges = pauses.map((p) => p.cut);
    const outcome = cutTranscriptRanges(ranges, "Remove pauses");
    report(`Removed ${pauses.length} pauses`, outcome);
    if (outcome.success) setTool(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [role=combobox]")) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selectedRange) {
      event.preventDefault();
      event.stopPropagation();
      deleteSelection();
    } else if (event.key === "Escape") setSelection(null);
  };

  const importFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lang = language.trim();
    const rate = broadcastFrameRate("import", frameRate);
    const outcome = await importCaptionBytes(bytes, {
      ...(lang ? { language: lang, captionTrackId: lang } : {}),
      ...(rate ? { frameRate: rate } : {}),
      offsetSeconds: Number(programmeStart),
      ccChannel: Number(ccChannel) as 1 | 2 | 3 | 4,
      fileName: file.name,
    });
    if (outcome.success) {
      if (lang) setTrackId(lang);
      setExportNotes([...skippedNotes(outcome.errors), ...(outcome.issues ?? [])]);
      toast.success(
        `Imported ${outcome.added} caption${outcome.added === 1 ? "" : "s"}`,
        outcome.errors?.length ? `${outcome.errors.length} skipped, see the notes in the Transcript panel` : undefined,
      );
    } else {
      setExportNotes([...skippedNotes(outcome.errors), ...(outcome.issues ?? [])]);
      toast.error(`Could not import ${file.name}`, outcome.message);
    }
  };

  const broadcast = exportFormat === "scc" || exportFormat === "mcc" || exportFormat === "stl";

  const exportFile = async () => {
    const info = CAPTION_FORMAT_INFO[exportFormat];
    const rate = broadcastFrameRate(exportFormat, frameRate);
    const file = await exportCaptionBytes(exportFormat, {
      ...(tracks.length > 1 ? { captionTrackId: activeTrack } : {}),
      includeSpeakers: exportSpeakers,
      ...(rate ? { frameRate: rate } : {}),
      ...(broadcast ? { offsetSeconds: Number(programmeStart) } : {}),
      ...(exportFormat === "vtt" ? { metadataNote: captionMetadataNotes(useProjectStore.getState().project) } : {}),
    });
    setExportNotes(file.issues);
    const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: `${file.mimeType}${info.binary ? "" : ";charset=utf-8"}` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `captions${activeTrack && tracks.length > 1 ? `-${activeTrack}` : ""}.${info.extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const problems = file.issues.filter((i) => i.severity !== "info").length;
    if (problems) toast.warning(`${info.label} exported with ${problems} note${problems === 1 ? "" : "s"}`, "See the export notes in the Transcript panel.");
  };

  const onRename = async (from: string, to: string) => {
    const outcome = await renameTranscriptSpeaker(from, to);
    if (!outcome.success) toast.error("Rename failed", outcome.message);
  };

  const onReassign = async (wordStart: number, wordEnd: number, speaker: string) => {
    const ids = [...new Set(words.slice(wordStart, wordEnd).map((w) => w.subtitleId))];
    const outcome = await setCaptionSpeaker(ids, speaker);
    if (!outcome.success) toast.error("Reassign failed", outcome.message);
  };

  const fillerTotal = cutDuration(chosenFillers);
  const pauseTotal = cutDuration(mergeTimeRanges(pauses.map((p) => p.cut)));
  const estimated = words.some((w) => w.estimated);

  const toolbarButton =
    "h-7 px-2 text-[11px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg";

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="transcript-panel"
      aria-label="Transcript"
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Search transcript"
            placeholder="Search transcript"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setMatchCursor(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") jumpToMatch(e.shiftKey ? matchCursor - 1 : matchCursor + (query ? 1 : 0));
            }}
            className="h-7 min-w-0 flex-1 text-[11px]"
          />
          {query && (
            <>
              <span className="shrink-0 text-[10px] text-fg-3" aria-live="polite">
                {matches.length ? `${Math.min(matchCursor + 1, matches.length)}/${matches.length}` : "0"}
              </span>
              <Button
                type="button"
                variant="ghost"
                aria-label="Next match"
                disabled={!matches.length}
                onClick={() => jumpToMatch(matchCursor + 1)}
                className="h-7 w-7 p-0 text-[11px]"
              >
                ↓
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            className={toolbarButton}
            aria-pressed={tool === "fillers"}
            disabled={!words.length}
            onClick={() => setTool(tool === "fillers" ? null : "fillers")}
          >
            Remove filler words
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={toolbarButton}
            aria-pressed={tool === "pauses"}
            disabled={!words.length}
            onClick={() => setTool(tool === "pauses" ? null : "pauses")}
          >
            Remove pauses
          </Button>
          {detect ? (
            <Button
              type="button"
              variant="ghost"
              className={toolbarButton}
              onClick={() => detectAbort.current?.abort()}
              aria-label="Cancel speaker detection"
            >
              {detect.message} {Math.round(detect.progress * 100)}% · Cancel
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                className={toolbarButton}
                disabled={!words.length}
                onClick={() => void detectSpeakers()}
                title="Label who is speaking, on this device. Approximate: best with clearly different voices and one person talking at a time."
              >
                Detect speakers
              </Button>
              <select
                aria-label="Number of speakers"
                value={speakerCount}
                onChange={(e) => setSpeakerCount(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-7 rounded border border-border bg-bg-2 px-1 text-[11px] text-fg-2"
              >
                <option value="auto">Auto</option>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} speaker{n === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            className={toolbarButton}
            aria-pressed={tool === "translate"}
            disabled={!subtitles.length}
            onClick={() => setTool(tool === "translate" ? null : "translate")}
          >
            Translate
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={toolbarButton}
            aria-label="Delete selected transcript text"
            disabled={!selectedRange}
            onClick={deleteSelection}
          >
            Delete{selectedCount ? ` ${selectedCount} word${selectedCount === 1 ? "" : "s"}` : ""}
          </Button>
        </div>

        {tool === "translate" && (
          <CaptionTranslateSection
            trackId={activeTrack}
            trackLanguage={tracks.find((t) => t.id === activeTrack)?.language}
            cueCount={tracks.find((t) => t.id === activeTrack)?.cueCount ?? 0}
            onTranslated={(id) => {
              setTrackId(id);
              setTool(null);
            }}
          />
        )}

        {tool === "fillers" && (
          <section
            aria-label="Filler word preview"
            className="space-y-1.5 rounded-md border border-border bg-bg-1 p-2"
          >
            <Input
              aria-label="Filler words to remove"
              value={fillerText}
              onChange={(e) => setFillerText(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 text-[11px]"
            />
            {fillers.length ? (
              <ul className="max-h-20 space-y-0.5 overflow-y-auto pr-1">
                {fillers.map((f) => (
                  <li key={f.wordStart} className="flex items-center gap-2 text-[11px] text-fg-2">
                    <Checkbox
                      aria-label={`Remove "${f.text}" at ${seconds(f.start)}`}
                      className="size-3.5"
                      checked={!skipped.has(f.wordStart)}
                      onCheckedChange={(on) =>
                        setSkipped((prev) => {
                          const next = new Set(prev);
                          if (on === true) next.delete(f.wordStart);
                          else next.add(f.wordStart);
                          return next;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:text-fg"
                      onClick={() => seekTo(f.start)}
                    >
                      “{f.text}”
                    </button>
                    <span className="shrink-0 font-mono text-[10px] text-fg-3">{seconds(f.start)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-fg-3">No filler words found.</p>
            )}
            <Button
              type="button"
              className="h-7 w-full text-[11px]"
              disabled={!chosenFillers.length}
              onClick={applyFillers}
            >
              Remove {chosenFillers.length} filler{chosenFillers.length === 1 ? "" : "s"} ({seconds(fillerTotal)})
            </Button>
          </section>
        )}

        {tool === "pauses" && (
          <section aria-label="Pause removal" className="space-y-1.5 rounded-md border border-border bg-bg-1 p-2">
            <label className="flex items-center gap-2 text-[11px] text-fg-2">
              Pauses longer than
              <Input
                aria-label="Minimum pause length in seconds"
                type="number"
                min={0}
                step={0.1}
                value={pauseMin}
                onChange={(e) => setPauseMin(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-7 w-16 px-1.5 text-[11px]"
              />
              s
            </label>
            <p className="text-[11px] text-fg-3" aria-live="polite">
              {pauses.length
                ? `${pauses.length} pause${pauses.length === 1 ? "" : "s"}, ${seconds(pauseTotal)} would be removed (0.20s of breathing room is kept).`
                : "No pauses that long."}
            </p>
            <Button type="button" className="h-7 w-full text-[11px]" disabled={!pauses.length} onClick={applyPauses}>
              Remove {pauses.length} pause{pauses.length === 1 ? "" : "s"}
            </Button>
          </section>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className="space-y-2.5 px-2.5 py-2.5 text-[12px] leading-[1.75] text-fg"
          onPointerDown={onWordPointerDown}
          onPointerOver={onWordPointerOver}
          onDoubleClick={onWordDoubleClick}
        >
          {!words.length && (
            <p className="py-6 text-center text-[11px] text-fg-3">
              No transcript yet. Import SRT, WebVTT, SCC, MCC, EBU-STL, TTML or a word-timed transcript JSON below.
            </p>
          )}
          {sentences.map((sentence, i) => {
            const previous = sentences[i - 1];
            const speakerChanged = sentence.speaker !== previous?.speaker;
            return (
              <p key={sentence.index} data-sentence-index={sentence.index} className="m-0">
                {(speakerChanged || i === 0) && (sentence.speaker || speakers.length > 0) && (
                  <span className="mb-0.5 flex items-center gap-1.5">
                    <SpeakerLabel
                      name={sentence.speaker}
                      color={profiles.find((p) => p.name === sentence.speaker)?.color}
                      onRename={onRename}
                    />
                    <SpeakerReassign
                      current={sentence.speaker}
                      names={speakers}
                      onAssign={(name) => void onReassign(sentence.wordStart, sentence.wordEnd, name)}
                    />
                    <span className="font-mono text-[10px] text-fg-3">
                      {formatFrameTimecode(sentence.start, frameRate)}
                    </span>
                  </span>
                )}
                {words.slice(sentence.wordStart, sentence.wordEnd).map((word) => (
                  <React.Fragment key={word.id}>
                    <Word
                      word={word}
                      active={word.index === activeIndex}
                      selected={word.index >= selFirst && word.index <= selLast}
                      matched={matchedWords.has(word.index)}
                      removing={removing.has(word.index)}
                    />{" "}
                  </React.Fragment>
                ))}
              </p>
            );
          })}
        </div>
      </ScrollArea>

      <div className="shrink-0 space-y-1.5 border-t border-border px-2.5 py-2">
        {profiles.length > 0 && (
          <section aria-label="Speakers">
            <button
              type="button"
              aria-expanded={speakersOpen}
              aria-controls="transcript-speaker-list"
              title="Colour and position carry into the captions"
              onClick={() => setSpeakersOpen((open) => !open)}
              className="flex w-full items-center gap-2 rounded px-0.5 py-0.5 text-left hover:bg-bg-3"
            >
              <span className="shrink-0 text-[11px] font-semibold text-fg-2">Speakers</span>
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                {profiles.map((profile) => (
                  <span key={profile.name} className="flex min-w-0 items-center gap-1 text-[10px] text-fg-3">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
                    <span className="truncate">{profile.name}</span>
                  </span>
                ))}
              </span>
              <span aria-hidden className="shrink-0 text-[10px] text-fg-3">
                {speakersOpen ? "Hide" : "Edit"}
              </span>
            </button>
            {speakersOpen && (
              <ul id="transcript-speaker-list" className="m-0 mt-1 max-h-24 list-none space-y-1 overflow-y-auto p-0 pr-1">
                {profiles.map((profile) => (
                  <SpeakerRow
                    key={profile.name}
                    profile={profile}
                    others={profiles.filter((p) => p.name !== profile.name).map((p) => p.name)}
                    onRename={onRename}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
        {profiles.length > 0 && (
          <p className="text-[10px] text-fg-3" data-testid="speaker-limits-note">
            Speakers are matched by voice on this device. It is approximate: similar voices can merge, one voice can
            split, and overlapping speech is not separated. Check the labels and fix any passage with its menu.
          </p>
        )}
        {estimated && (
          <p className="text-[10px] text-fg-3">
            Some captions have no word timings; their word times are estimated from the caption.
          </p>
        )}
        {tracks.length > 1 && (
          <label className="flex items-center justify-between gap-2 text-[11px] text-fg-2">
            <span>Show this track in the picture</span>
            <Switch
              aria-label="Show this caption track in the picture"
              checked={!trackHidden}
              onCheckedChange={(visible) => {
                void setCaptionTrackInPicture(activeTrack, visible).then((o) => {
                  if (!o.success) toast.error("Could not change the picture", o.message);
                });
              }}
            />
          </label>
        )}
        {tracks.length > 1 && (
          <Select value={activeTrack || DEFAULT_TRACK_VALUE} onValueChange={(v) => setTrackId(v === DEFAULT_TRACK_VALUE ? "" : v)}>
            <SelectTrigger aria-label="Caption track" className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tracks.map((t) => (
                <SelectItem key={t.id || "default"} value={t.id || DEFAULT_TRACK_VALUE}>
                  {t.id ? `${t.id}${t.language ? ` (${t.language})` : ""}` : "Default captions"} · {t.cueCount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Language of the imported captions"
            placeholder="Language (en, fr…)"
            value={language}
            onChange={(e) => setLanguage(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 text-[11px]"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,.sbv,.ttml,.dfxp,.itt,.xml,.json,.txt,.scc,.mcc,.stl"
            data-testid="transcript-import-input"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void importFile(file);
            }}
          />
          <Select value={ccChannel} onValueChange={(v) => setCcChannel(v as "1" | "2" | "3" | "4")}>
            <SelectTrigger aria-label="CEA-608 caption channel for SCC and MCC import" title="Which CEA-608 caption channel an SCC or MCC import reads" className="h-7 w-[58px] shrink-0 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["1", "2", "3", "4"] as const).map((c) => (
                <SelectItem key={c} value={c}>
                  CC{c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" className={toolbarButton} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
        </div>
        {broadcast && (
          <div className="flex items-center gap-1.5 text-[10px] text-fg-3">
            <span className="shrink-0">Programme start</span>
            <Select value={programmeStart} onValueChange={setProgrammeStart}>
              <SelectTrigger aria-label="Programme start timecode" className="h-7 min-w-0 flex-1 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROGRAMME_STARTS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as CaptionExportFormat)}>
            <SelectTrigger aria-label="Caption export format" className="h-7 min-w-0 flex-1 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAPTION_EXPORT_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {CAPTION_FORMAT_INFO[f].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            className={toolbarButton}
            aria-label="Export captions"
            disabled={!subtitles.length}
            onClick={() => void exportFile()}
          >
            Export
          </Button>
        </div>
        {speakers.length > 0 && (
          <label className="flex items-center gap-1.5 text-[10px] text-fg-3" title="SRT: a 'Name: ' prefix. WebVTT: <v Name> voice tags. TTML: speaker agents.">
            <input
              type="checkbox"
              checked={exportSpeakers}
              onChange={(e) => setExportSpeakers(e.currentTarget.checked)}
              aria-label="Include speaker names in exported captions"
            />
            Include speaker names in the export
          </label>
        )}
        {exportNotes.length > 0 && (
          <ul
            className="m-0 max-h-24 list-none space-y-0.5 overflow-y-auto p-0 text-[10px] leading-snug"
            data-testid="caption-export-report"
            aria-label="Caption export notes"
          >
            {exportNotes.slice(0, 20).map((note, i) => (
              <li
                key={`${note.code}-${note.cueId ?? ""}-${i}`}
                className={note.severity === "error" ? "text-status-error" : note.severity === "warning" ? "text-status-warning" : "text-fg-3"}
              >
                {note.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
