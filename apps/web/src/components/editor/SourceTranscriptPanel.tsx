import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  searchSourceTranscripts,
  selectionToSourceMarks,
  wordIndexAt,
  type SourceSearchHit,
  type SourceTranscriptEntry as SearchEntry,
} from "@openreel/core";
import { Button, Input } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { useSourceTranscripts, getSourceTranscriptStore } from "../../stores/source-transcript-store";
import { insertFromSource, openInSourceMonitor, overwriteFromSource, setSourceMarks } from "../../services/source-monitor-commands";
import { runWithToast } from "../../services/premiere-edit-commands";
import { cuesFromTranscriptText } from "../../services/source-transcripts/import-cues";
import { toast } from "../../stores/notification-store";
import { formatFrameTimecode } from "../../utils/frame-timecode";

/**
 * Transcript tab of the Source monitor: text-based editing on a source clip. Selecting words sets the clip's Source
 * In/Out marks, and Insert / Overwrite (the same commands as the monitor's buttons) put exactly that range on the
 * timeline as one undo step. The search box finds words, phrases and speakers (`speaker:Ann`) in this clip or in every
 * transcribed clip of the project; a result opens its clip at that time with the words selected.
 */
interface Selection {
  mediaId: string;
  first: number;
  last: number;
}

const PAD_SECONDS = 0;

export function SourceTranscriptPanel() {
  const mediaId = useSourceMonitorStore((s) => s.mediaId);
  const external = useSourceMonitorStore((s) => s.externalPreview);
  const position = useSourceMonitorStore((s) => s.position);
  const items = useProjectStore((s) => s.project.mediaLibrary.items);
  const frameRate = useProjectStore((s) => s.project.settings.frameRate) || 30;
  const media = !external && mediaId ? items.find((m) => m.id === mediaId) : undefined;
  const entry = useSourceTranscripts((s) => (media ? s.entries[media.id] : undefined));
  const entries = useSourceTranscripts((s) => s.entries);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"clip" | "all">("clip");
  const [fuzzy, setFuzzy] = useState(false);
  const [speaker, setSpeaker] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const dragging = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Look the loaded clip up in the cache (hashes the file; never transcribes by itself).
  useEffect(() => {
    if (media && media.type !== "image") void getSourceTranscriptStore().getState().refresh(media);
  }, [media]);

  // Searching every clip needs every clip's cached transcript.
  useEffect(() => {
    if (scope === "all") void getSourceTranscriptStore().getState().refreshAll(items);
  }, [scope, items]);

  const transcript = entry?.transcript;
  const words = useMemo(() => transcript?.words ?? [], [transcript]);
  const speakers = useMemo(() => [...new Set(words.map((w) => w.speaker).filter((s): s is string => !!s))], [words]);

  const searchEntries = useMemo<SearchEntry[]>(() => {
    const ids = scope === "clip" ? (media ? [media.id] : []) : items.map((m) => m.id);
    return ids.flatMap((id) => {
      const e = entries[id];
      const item = items.find((m) => m.id === id);
      return e?.transcript && item ? [{ mediaId: id, mediaName: item.name, transcript: e.transcript }] : [];
    });
  }, [scope, media, items, entries]);

  const hits = useMemo(
    () => (query.trim() || speaker ? searchSourceTranscripts(searchEntries, query, { fuzzy, ...(speaker ? { speaker } : {}) }) : []),
    [searchEntries, query, fuzzy, speaker],
  );
  const hitWords = useMemo(() => {
    const set = new Set<number>();
    if (media) for (const hit of hits) if (hit.mediaId === media.id) for (let i = hit.wordStart; i <= hit.wordEnd; i++) set.add(i);
    return set;
  }, [hits, media]);

  const activeWord = words.length ? wordIndexAt(words, position) : -1;
  // A selection only counts while its words still exist (a removed, replaced or relinked transcript drops it).
  const selected =
    selection && media && selection.mediaId === media.id && Math.max(selection.first, selection.last) < words.length && Math.min(selection.first, selection.last) >= 0
      ? selection
      : null;
  const lo = selected ? Math.min(selected.first, selected.last) : -1;
  const hi = selected ? Math.max(selected.first, selected.last) : -1;

  const applySelection = useCallback(
    (id: string, first: number, last: number, from = transcript, duration = media?.metadata.duration) => {
      if (!from) return;
      try {
        const marks = selectionToSourceMarks(from, first, last, { pad: PAD_SECONDS, ...(duration ? { duration } : {}) });
        const outcome = setSourceMarks(id, marks);
        if (!outcome.success) return void toast.warning("Transcript selection", outcome.message);
        setSelection({ mediaId: id, first, last });
      } catch (error) {
        toast.warning("Transcript selection", error instanceof Error ? error.message : "That selection cannot be marked.");
      }
    },
    [transcript, media?.metadata.duration],
  );

  const select = (index: number, extend: boolean) => {
    if (!media) return;
    const anchor = extend && selected ? selected.first : index;
    applySelection(media.id, anchor, index);
    useSourceMonitorStore.getState().setPosition(words[Math.min(anchor, index)].start);
  };

  const selectSentence = (index: number) => {
    if (!media || !transcript) return;
    const sentence = transcript.sentences.find((s) => index >= s.wordStart && index < s.wordEnd);
    if (sentence) applySelection(media.id, sentence.wordStart, sentence.wordEnd - 1);
  };

  const openHit = (hit: SourceSearchHit) => {
    const target = entries[hit.mediaId];
    const item = items.find((m) => m.id === hit.mediaId);
    if (!target?.transcript || !item) return;
    openInSourceMonitor(hit.mediaId, hit.time);
    applySelection(hit.mediaId, hit.wordStart, hit.wordEnd, target.transcript, item.metadata.duration);
    useSourceMonitorStore.getState().setPosition(hit.time);
  };

  const importFile = async (file: File) => {
    if (!media) return;
    const { cues, errors } = cuesFromTranscriptText(await file.text(), `imp-${media.id.slice(0, 6)}`);
    if (!cues.length) return void toast.warning("Import transcript", errors[0] ?? "No transcript was found in that file.");
    await getSourceTranscriptStore().getState().adopt(media, cues, "import");
  };

  const edit = (mode: "insert" | "overwrite") => {
    if (!selected) return;
    runWithToast(mode === "insert" ? "Insert" : "Overwrite", () => (mode === "insert" ? insertFromSource() : overwriteFromSource()));
  };

  useEffect(() => {
    const stop = () => (dragging.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const tc = (seconds: number) => formatFrameTimecode(seconds, frameRate);
  const status = entry?.status ?? "idle";
  const selectedText = selected ? words.slice(lo, hi + 1).map((w) => w.text).join(" ") : "";

  return (
    <div data-testid="source-transcript-panel" aria-label="Source transcript" className="flex min-h-0 flex-1 flex-col text-[11px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <Input
          aria-label="Find in transcripts"
          data-testid="source-transcript-search"
          placeholder={scope === "all" ? "Find in all transcripts (speaker:Ann)" : "Find in this transcript"}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 min-w-[140px] flex-1 text-[11px]"
        />
        <div role="group" aria-label="Search scope" className="flex overflow-hidden rounded border border-border">
          {(["clip", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`source-transcript-scope-${value}`}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={`px-2 py-1 ${scope === value ? "bg-bg-2 font-semibold text-fg" : "text-fg-3 hover:text-fg-2"}`}
            >
              {value === "clip" ? "This clip" : "All clips"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-fg-3">
          <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.currentTarget.checked)} data-testid="source-transcript-fuzzy" />
          Fuzzy
        </label>
        {(speakers.length > 0 || scope === "all") && (
          <Input
            aria-label="Speaker filter"
            placeholder="Speaker"
            value={speaker}
            onChange={(e) => setSpeaker(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-7 w-24 text-[11px]"
          />
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-fg-3" data-testid="source-transcript-selection-range">
            {selected ? `${tc(words[lo].start)} – ${tc(words[hi].end)}` : ""}
          </span>
          <Button type="button" variant="secondary" size="sm" data-testid="source-transcript-insert" disabled={!selected} title="Insert the selected text at the timeline playhead" onMouseDown={(e) => e.preventDefault()} onClick={() => edit("insert")}>
            Insert
          </Button>
          <Button type="button" variant="secondary" size="sm" data-testid="source-transcript-overwrite" disabled={!selected} title="Overwrite the timeline from the playhead with the selected text" onMouseDown={(e) => e.preventDefault()} onClick={() => edit("overwrite")}>
            Overwrite
          </Button>
        </span>
      </div>

      {(query.trim() || speaker) && (
        <ul data-testid="source-transcript-results" aria-label="Transcript search results" className="max-h-[38%] shrink-0 overflow-y-auto border-b border-border">
          {hits.length === 0 ? (
            <li className="px-2.5 py-1.5 text-fg-3" data-testid="source-transcript-no-results">
              {scope === "all" && Object.values(entries).every((e) => !e.transcript)
                ? "No clip has a transcript yet. Open a clip and transcribe it."
                : "No matches."}
            </li>
          ) : (
            hits.map((hit) => (
              <li key={`${hit.mediaId}:${hit.wordStart}`}>
                <button
                  type="button"
                  data-testid="source-transcript-result"
                  data-media-id={hit.mediaId}
                  data-time={hit.time}
                  onClick={() => openHit(hit)}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1 text-left hover:bg-bg-2"
                >
                  <span className="shrink-0 font-mono tabular-nums text-fg-3">{tc(hit.time)}</span>
                  {scope === "all" && <span className="shrink-0 max-w-[30%] truncate font-medium text-fg-2">{hit.mediaName}</span>}
                  {hit.speaker && <span className="shrink-0 text-fg-3">{hit.speaker}</span>}
                  <span className="min-w-0 truncate text-fg-3">
                    {hit.before} <mark className="rounded bg-accent/25 px-0.5 text-fg">{hit.match}</mark> {hit.after}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {!media ? (
          <p className="text-fg-3">Load a clip in the Source monitor to see its transcript.</p>
        ) : media.type === "image" ? (
          <p className="text-fg-3">Images have no transcript.</p>
        ) : status === "offline" ? (
          <p className="text-fg-3">This media is offline. Relink it to work with its transcript.</p>
        ) : status === "transcribing" ? (
          <p data-testid="source-transcript-progress" className="text-fg-2">
            {entry?.message ?? "Transcribing…"} {typeof entry?.progress === "number" ? `${Math.round(entry.progress * 100)}%` : ""}
          </p>
        ) : transcript && words.length ? (
          <div data-testid="source-transcript-words" className="leading-[1.9]">
            {entry?.record?.engine === "whisper" && (
              <p className="mb-1 text-fg-3">Word times inside each phrase are estimated.</p>
            )}
            {transcript.sentences.map((sentence) => (
              <p key={sentence.index} className="mb-1.5">
                <span className="mr-2 font-mono tabular-nums text-fg-3">{tc(sentence.start)}</span>
                {sentence.speaker && <span className="mr-2 font-medium text-fg-2">{sentence.speaker}</span>}
                {words.slice(sentence.wordStart, sentence.wordEnd).map((word) => {
                  const isSelected = word.index >= lo && word.index <= hi;
                  return (
                    <span
                      key={word.id}
                      role="button"
                      tabIndex={-1}
                      data-word-index={word.index}
                      data-selected={isSelected ? "true" : undefined}
                      data-active={word.index === activeWord ? "true" : undefined}
                      data-match={hitWords.has(word.index) ? "true" : undefined}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        dragging.current = word.index;
                        select(word.index, e.shiftKey);
                      }}
                      onPointerEnter={(e) => {
                        if (dragging.current === null || !(e.buttons & 1) || !media) return;
                        applySelection(media.id, dragging.current, word.index);
                      }}
                      onDoubleClick={() => selectSentence(word.index)}
                      className={`cursor-pointer select-none rounded px-0.5 ${
                        isSelected ? "bg-accent/35 text-fg" : word.index === activeWord ? "bg-bg-2 text-fg" : hitWords.has(word.index) ? "bg-accent/15 text-fg" : "text-fg-2 hover:bg-bg-2"
                      }`}
                    >
                      {word.text}{" "}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-fg-2">
              {status === "error" ? entry?.error ?? "Transcription failed." : entry?.relinked ? "This media was relinked to different content, so its earlier transcript was dropped." : "This clip has not been transcribed yet."}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" data-testid="source-transcript-transcribe" disabled={status === "checking"} onMouseDown={(e) => e.preventDefault()} onClick={() => void getSourceTranscriptStore().getState().transcribe(media)}>
                Transcribe clip
              </Button>
              <Button type="button" size="sm" variant="ghost" data-testid="source-transcript-import" onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
                Import transcript
              </Button>
            </div>
            <p className="text-fg-3">Transcribing runs on this device and the result is remembered for this file.</p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt,.json,.txt"
          data-testid="source-transcript-import-input"
          className="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      {selected && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-1 text-fg-3">
          <span className="min-w-0 flex-1 truncate" data-testid="source-transcript-selected-text">{selectedText}</span>
          <button type="button" className="hover:text-fg-2" onClick={() => setSelection(null)}>
            Deselect
          </button>
        </div>
      )}
    </div>
  );
}

export default SourceTranscriptPanel;
