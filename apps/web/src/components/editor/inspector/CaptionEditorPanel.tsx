import { cn } from "@openreel/ui";
import { Button as ShadcnButton, Input, Textarea, Checkbox } from "@openreel/ui";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getMediaItemCapabilities, splitCaptionIntoSingleLineCues } from "@openreel/core";
import { Button, Card, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";
import { Check, WrapText } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { createCaptionSearch } from "../../../utils/caption-search";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { toast } from "../../../stores/notification-store";

interface CaptionEditorPanelProps {
  maxWordsPerLine: number;
  onMaxWordsPerLineChange: (value: number) => void;
  renderPanel?: (content: React.ReactNode) => React.ReactNode;
}

export const CaptionEditorPanel: React.FC<CaptionEditorPanelProps> = ({
  maxWordsPerLine,
  onMaxWordsPerLineChange,
  renderPanel,
}) => {
  const project = useProjectStore((state) => state.project);
  const getAllTextClips = useProjectStore((state) => state.getAllTextClips);
  const updateTextContent = useProjectStore((state) => state.updateTextContent);
  const pasteOverlayClip = useProjectStore((state) => state.pasteOverlayClip);
  const updateOverlayClipTiming = useProjectStore(
    (state) => state.updateOverlayClipTiming,
  );
  const captionTrackIds = useMemo(
    () =>
      new Set(
        project.timeline.tracks
          .filter(
            (track) =>
              track.role === "captions" || track.name === "Captions",
          )
          .map((track) => track.id),
      ),
    [project.timeline.tracks],
  );
  const projectRevision = project.modifiedAt;
  const captions = useMemo(() => {
    void projectRevision;
    return getAllTextClips()
      .filter(
        (clip) =>
          captionTrackIds.has(clip.trackId) ||
          typeof clip.metadata?.captionSource === "string",
      )
      .sort((left, right) => left.startTime - right.startTime);
  }, [captionTrackIds, getAllTextClips, projectRevision]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const previousTexts = useRef<Record<string, string>>({});
  const [findText, setFindText] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [page, setPage] = useState(0);
  const [subtitlePage, setSubtitlePage] = useState(0);
  const [resultMessage, setResultMessage] = useState("");
  const [movingTracks, setMovingTracks] = useState(false);
  const movingRef = useRef(false);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const playbackLocked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const lockedTracks = useMemo(() => new Set(project.timeline.tracks.filter((track) => track.locked).map((track) => track.id)), [project.timeline.tracks]);
  const search = useMemo(() => createCaptionSearch(findText, { matchCase, wholeWords }), [findText, matchCase, wholeWords]);
  const filtered = useMemo(() => captions.filter((caption) => !findText || search.count(drafts[caption.id] ?? caption.text) > 0), [captions, drafts, findText, search]);
  const selectable = filtered.filter((caption) => !lockedTracks.has(caption.trackId));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleCaptions = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const disabled = exporting || playbackLocked || movingTracks;
  const subtitles = project.timeline.subtitles;
  const subtitlePageCount = Math.max(1, Math.ceil(subtitles.length / 50));
  const currentSubtitlePage = Math.min(subtitlePage, subtitlePageCount - 1);
  const visibleSubtitles = subtitles.slice(currentSubtitlePage * 50, (currentSubtitlePage + 1) * 50);
  const firstVideoTrack = project.timeline.tracks.findIndex((track) => !track.hidden && track.clips.some((clip) =>
    getMediaItemCapabilities(project.mediaLibrary.items.find((media) => media.id === clip.mediaId)).visual));
  const coveredCaptionTracks = firstVideoTrack < 0 ? [] : project.timeline.tracks.filter((track, index) =>
    !track.hidden && captionTrackIds.has(track.id) && index > firstVideoTrack);

  useEffect(() => {
    const previous = previousTexts.current;
    setDrafts((current) => Object.fromEntries(captions.map((caption) => [caption.id,
      current[caption.id] === undefined || current[caption.id] === previous[caption.id] ? caption.text : current[caption.id],
    ])));
    previousTexts.current = Object.fromEntries(captions.map((caption) => [caption.id, caption.text]));
    setSelectedIds((current) => {
      const available = new Set(captions.map((caption) => caption.id));
      return new Set([...current].filter((id) => available.has(id)));
    });
  }, [captions]);

  const selectedCount = selectedIds.size;
  const allSelected = selectable.length > 0 && selectable.every((caption) => selectedIds.has(caption.id));
  const targets = captions.filter((caption) => !lockedTracks.has(caption.trackId) && (!selectedCount || selectedIds.has(caption.id)));
  const matched = targets.map((caption) => ({ caption, count: search.count(drafts[caption.id] ?? caption.text) })).filter((entry) => entry.count > 0);
  const matchCount = matched.reduce((total, entry) => total + entry.count, 0);

  const toggleAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const caption of selectable) { if (allSelected) next.delete(caption.id); else next.add(caption.id); }
      return next;
    });
  };

  const toggleCaption = (captionId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(captionId)) next.delete(captionId);
      else next.add(captionId);
      return next;
    });
  };

  const commitDraft = (captionId: string) => {
    const caption = captions.find((candidate) => candidate.id === captionId);
    const draft = drafts[captionId]?.trim();
    if (!caption || !draft || draft === caption.text || lockedTracks.has(caption.trackId) || disabled) return;
    updateTextContent(captionId, draft);
  };

  const splitSelectionIntoSingleLines = () => {
    if (disabled) return;
    const targets = selectedCount > 0 ? selectedIds : new Set(captions.map((clip) => clip.id));
    const history = useProjectStore.getState().actionExecutor.getHistory();
    history.beginGroup("Split captions into single lines");
    try {
      for (const caption of captions) {
        if (!targets.has(caption.id) || lockedTracks.has(caption.trackId)) continue;
        const cues = splitCaptionIntoSingleLineCues(
          drafts[caption.id] ?? caption.text,
          caption.startTime,
          caption.startTime + caption.duration,
          maxWordsPerLine,
        );
        const firstCue = cues[0];
        if (!firstCue) continue;

        updateTextContent(caption.id, firstCue.text);
        updateOverlayClipTiming(caption.id, {
          startTime: firstCue.startTime,
          duration: firstCue.endTime - firstCue.startTime,
        });

        for (const cue of cues.slice(1)) {
          const created = pasteOverlayClip(
            "text",
            caption,
            cue.startTime,
            caption.trackId,
          );
          if (!created || !("text" in created)) continue;
          updateTextContent(created.id, cue.text);
          updateOverlayClipTiming(created.id, {
            startTime: cue.startTime,
            duration: cue.endTime - cue.startTime,
          });
        }
      }
    } finally {
      history.endGroup();
    }
  };

  const replaceMatches = () => {
    if (disabled || !matched.length) return;
    const store = useProjectStore.getState();
    const replacements = matched.map(({ caption }) => ({ id: caption.id, text: search.replace(drafts[caption.id] ?? caption.text, replacement) }))
      .filter((entry) => entry.text !== store.getTextClip(entry.id)?.text);
    if (!replacements.length) return;
    store.beginHistoryGroup("Replace caption text");
    try {
      for (const entry of replacements) store.updateTextContent(entry.id, entry.text);
    } finally { store.endHistoryGroup(); }
    setDrafts((current) => ({ ...current, ...Object.fromEntries(replacements.map((entry) => [entry.id, entry.text])) }));
    setResultMessage(`Replaced ${matchCount} matches in ${replacements.length} captions. Undo restores the batch.`);
  };

  const bringCaptionTracksForward = async () => {
    if (disabled || movingRef.current) return;
    const tracks = coveredCaptionTracks.filter((track) => !track.locked);
    if (!tracks.length) return;
    const store = useProjectStore.getState();
    const projectId = store.project.id;
    movingRef.current = true; setMovingTracks(true);
    useTimelineStore.getState().pause();
    store.beginHistoryGroup("Bring caption tracks to front");
    try {
      for (const track of [...tracks].reverse()) {
        if (useProjectStore.getState().project.id !== projectId) break;
        const result = await useProjectStore.getState().reorderTrack(track.id, 0);
        if (!result.success) throw new Error(result.error?.message || "Could not move the caption track.");
      }
    } catch (cause) { toast.error("Caption placement failed", cause instanceof Error ? cause.message : "Please try again."); }
    finally {
      if (useProjectStore.getState().project.id === projectId) store.endHistoryGroup();
      movingRef.current = false; setMovingTracks(false);
    }
  };

  const content = (
    <div className="space-y-3">
      {subtitles.length > 0 && <section aria-label="Subtitles" className="space-y-2 rounded-lg border border-border bg-bg-1 p-3">
        <h3 className="text-xs font-semibold text-fg">Subtitles</h3>
        <p className="text-[10px] text-fg-3">Select a subtitle to edit its text, timing and style.</p>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {visibleSubtitles.map((subtitle, index) => <Button key={subtitle.id} type="button" variant="outline"
            aria-label={`Edit subtitle ${currentSubtitlePage * 50 + index + 1}`} disabled={disabled}
            className="h-auto min-h-10 w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal"
            onClick={() => {
              const timeline = useTimelineStore.getState(); timeline.pause(); timeline.seekTo(subtitle.startTime); timeline.scrollToPlayhead();
              useUIStore.getState().select({ type: "subtitle", id: subtitle.id });
            }}>
            <span className="shrink-0 font-mono text-[10px] text-accent">{formatFrameTimecode(subtitle.startTime, project.settings.frameRate)}</span>
            <span className="truncate">{subtitle.text}</span>
          </Button>)}
        </div>
        {subtitlePageCount > 1 && <div className="flex items-center justify-between gap-2 text-[11px] text-fg-2" aria-label="Subtitle pages">
          <Button type="button" variant="ghost" size="sm" aria-label="Previous subtitle page" disabled={currentSubtitlePage === 0}
            onClick={() => setSubtitlePage(currentSubtitlePage - 1)}>Previous</Button>
          <span>{currentSubtitlePage + 1} / {subtitlePageCount} · {subtitles.length} subtitles</span>
          <Button type="button" variant="ghost" size="sm" aria-label="Next subtitle page" disabled={currentSubtitlePage + 1 >= subtitlePageCount}
            onClick={() => setSubtitlePage(currentSubtitlePage + 1)}>Next</Button>
        </div>}
      </section>}
      {coveredCaptionTracks.length > 0 && <section aria-label="Caption visibility" className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
        <p className="text-xs leading-relaxed text-fg-2">Caption tracks are behind video. Bring them to the front so they are visible in your export.</p>
        <Button onClick={() => void bringCaptionTracksForward()} type="button" aria-label={(movingTracks ? "Moving captions…" : "Bring caption tracks to front").trim() || undefined} disabled={(disabled || coveredCaptionTracks.every((track) => track.locked))} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-10 w-full justify-center">
          <span className="truncate">{movingTracks ? "Moving captions…" : "Bring caption tracks to front"}</span>
        </Button>
        {coveredCaptionTracks.some((track) => track.locked) && <p className="text-[10px] text-fg-3">Unlock caption tracks to change their layer order.</p>}
      </section>}
      {captions.length > 0 && <section aria-label="Find and replace captions" className="space-y-2 rounded-lg border border-border bg-bg-1 p-3">
        <h3 className="text-xs font-semibold text-fg">Find and replace</h3>
        <Input aria-label="Find caption text" placeholder="Find words in captions" value={findText}
          onChange={(event) => { setFindText(event.currentTarget.value); setPage(0); setResultMessage(""); }}
          className="inline-block h-auto min-h-10 w-full rounded border border-border bg-bg-2 px-2 py-0 text-xs text-fg outline-none focus:border-accent md:text-xs" />
        <Input aria-label="Replace caption text with" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.currentTarget.value)}
          className="inline-block h-auto min-h-10 w-full rounded border border-border bg-bg-2 px-2 py-0 text-xs text-fg outline-none focus:border-accent md:text-xs" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2">
          <label className="flex min-h-8 items-center gap-1.5"><Checkbox aria-label="Match case" className="size-3.5 [&_svg]:size-3" checked={matchCase} onCheckedChange={(checked) => { setMatchCase(checked === true); setPage(0); }} />Match case</label>
          <label className="flex min-h-8 items-center gap-1.5"><Checkbox aria-label="Whole words" className="size-3.5 [&_svg]:size-3" checked={wholeWords} onCheckedChange={(checked) => { setWholeWords(checked === true); setPage(0); }} />Whole words</label>
        </div>
        <p className="text-[11px] text-fg-3">{matchCount} matches in {matched.length} editable captions · {selectedCount ? "selected captions" : "all captions"}</p>
        <Button onClick={replaceMatches} type="button" aria-label={(selectedCount ? "Replace in selected captions" : "Replace in all captions").trim() || undefined} disabled={(disabled || matchCount === 0)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-10 w-full justify-center">
          <span className="truncate">{selectedCount ? "Replace in selected captions" : "Replace in all captions"}</span>
        </Button>
        {findText && <ShadcnButton variant="ghost" size="sm" type="button" onClick={() => { setFindText(""); setPage(0); }} className="h-auto min-h-8 p-0 text-xs font-normal text-accent hover:bg-transparent">Clear search</ShadcnButton>}
        <p className="text-[10px] leading-relaxed text-fg-3">Timing and styling stay the same. Locked tracks are skipped.</p>
        {resultMessage && <p role="status" className="text-[11px] text-accent">{resultMessage}</p>}
      </section>}
      <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-3 space-y-2 border border-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="font-bold block text-[11px] text-fg">
              {captions.length > 0 ? "Single-line captions" : "Words per caption"}
            </span>
            <span className="text-fg-2 font-normal block text-[9px]">
              {captions.length > 0 ? "Split each cue into timed clips for vertical video." : "New captions break into timed clips of this length."}
            </span>
          </div>
          <Select value={String(maxWordsPerLine)} onValueChange={value => onMaxWordsPerLineChange(Number(value))}>
            <SelectTrigger aria-label="Maximum words per caption" className="h-7 w-[84px] rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 10 }, (_, index) => <SelectItem key={index + 2} value={String(index + 2)}>{index + 2}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {captions.length > 0 && (
        <Button onClick={splitSelectionIntoSingleLines} type="button" aria-label={(selectedCount > 0
              ? `Make ${selectedCount} selected single-line`
              : `Make all ${captions.length} single-line`).trim() || undefined} disabled={(targets.length === 0 || disabled)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<WrapText size={13} aria-hidden />}</span>
          <span className="truncate">{selectedCount > 0
              ? `Make ${selectedCount} selected single-line`
              : `Make all ${captions.length} single-line`}</span>
        </Button>
        )}
      </Card>

      {captions.length === 0 && subtitles.length === 0 ? (
        <span className="text-fg-2 font-normal block py-3 text-center text-[10px]">
          Import SRT/VTT or transcribe the selected clip to create editable caption text.
        </span>
      ) : captions.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <ShadcnButton variant="ghost" size="sm"
              type="button"
              onClick={toggleAll}
              className="h-auto p-0 text-[10px] font-semibold leading-[inherit] text-accent hover:bg-transparent hover:underline"
            >
              {allSelected ? "Clear selection" : findText ? "Select matching" : "Select all"}
            </ShadcnButton>
            <span className="text-fg-2 font-normal text-[9px]">
              {captions.length} editable text clip{captions.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {visibleCaptions.map((caption) => {
              const index = captions.indexOf(caption);
              const locked = lockedTracks.has(caption.trackId);
              const selected = selectedIds.has(caption.id);
              return (
                <Card key={caption.id} className={cn("min-w-0 rounded-[7px] border shadow-none", "border-transparent bg-bg-2 text-fg", "p-2", `border ${selected ? "border-accent/60 bg-accent-soft" : "border-border"}`)}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <ShadcnButton variant="ghost" size="sm"
                      type="button"
                      aria-label={`${selected ? "Deselect" : "Select"} caption ${index + 1}`}
                      aria-pressed={selected}
                      disabled={locked || disabled}
                      onClick={() => toggleCaption(caption.id)}
                      className={`grid h-8 w-8 place-items-center rounded border p-0 [&_svg]:size-[11px] disabled:opacity-40 ${
                        selected
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-bg-1 text-transparent"
                      }`}
                    >
                      <Check size={11} aria-hidden />
                    </ShadcnButton>
                    <ShadcnButton variant="ghost" size="sm" type="button" aria-label={`Go to caption ${index + 1}`} disabled={playbackLocked || exporting}
                      onClick={() => { const timeline = useTimelineStore.getState(); timeline.pause(); timeline.seekTo(caption.startTime); timeline.scrollToPlayhead(); }}
                      className="h-auto min-h-8 p-0 font-mono text-[10px] font-normal leading-[inherit] text-accent hover:bg-transparent hover:underline disabled:opacity-40">
                      {formatFrameTimecode(caption.startTime, project.settings.frameRate)}
                    </ShadcnButton>
                  </div>
                  <Textarea
                    aria-label={`Caption ${index + 1} text`}
                    rows={Math.min(6, Math.max(2, (drafts[caption.id]?.split("\n").length ?? 1)))}
                    disabled={locked || disabled}
                    value={drafts[caption.id] ?? caption.text}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((current) => ({
                        ...current,
                        [caption.id]: value,
                      }));
                    }}
                    onBlur={() => commitDraft(caption.id)}
                    className="inline-block min-h-0 w-full resize-y rounded-md border border-border bg-bg-1 px-2 py-1.5 text-[11px] leading-relaxed text-fg outline-none focus:border-accent"
                  />
                  {locked && <p className="text-[10px] text-fg-3">Track locked</p>}
                </Card>
              );
            })}
          </div>
          {filtered.length === 0 && <p className="text-xs text-fg-3">No captions match this search.</p>}
          {pageCount > 1 && <div className="flex items-center justify-between gap-2 text-[11px] text-fg-2" aria-label="Caption pages">
            <ShadcnButton variant="ghost" size="sm" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="h-auto min-h-10 px-2 py-0 text-[length:inherit] font-normal leading-[inherit] text-accent hover:bg-transparent disabled:opacity-40">Previous</ShadcnButton>
            <span>{currentPage + 1} / {pageCount} · {filtered.length} captions</span>
            <ShadcnButton variant="ghost" size="sm" type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} className="h-auto min-h-10 px-2 py-0 text-[length:inherit] font-normal leading-[inherit] text-accent hover:bg-transparent disabled:opacity-40">Next</ShadcnButton>
          </div>}
        </>
      ) : null}
    </div>
  );
  return renderPanel ? renderPanel(content) : content;
};

