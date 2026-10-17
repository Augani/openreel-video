import React, { useEffect, useMemo, useRef, useState } from "react";
import { getMediaItemCapabilities, splitCaptionIntoSingleLineCues } from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
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
}

export const CaptionEditorPanel: React.FC<CaptionEditorPanelProps> = ({
  maxWordsPerLine,
  onMaxWordsPerLineChange,
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

  return (
    <div className="space-y-3">
      {coveredCaptionTracks.length > 0 && <section aria-label="Caption visibility" className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
        <p className="text-xs leading-relaxed text-fg-2">Caption tracks are behind video. Bring them to the front so they are visible in your export.</p>
        <Button label={movingTracks ? "Moving captions…" : "Bring caption tracks to front"} onClick={() => void bringCaptionTracksForward()}
          isDisabled={disabled || coveredCaptionTracks.every((track) => track.locked)} variant="secondary" size="sm" className="min-h-10 w-full justify-center" />
        {coveredCaptionTracks.some((track) => track.locked) && <p className="text-[10px] text-fg-3">Unlock caption tracks to change their layer order.</p>}
      </section>}
      {captions.length > 0 && <section aria-label="Find and replace captions" className="space-y-2 rounded-lg border border-border bg-bg-1 p-3">
        <h3 className="text-xs font-semibold text-fg">Find and replace</h3>
        <input aria-label="Find caption text" placeholder="Find words in captions" value={findText}
          onChange={(event) => { setFindText(event.currentTarget.value); setPage(0); setResultMessage(""); }}
          className="min-h-10 w-full rounded border border-border bg-bg-2 px-2 text-xs text-fg outline-none focus:border-accent" />
        <input aria-label="Replace caption text with" placeholder="Replace with" value={replacement} onChange={(event) => setReplacement(event.currentTarget.value)}
          className="min-h-10 w-full rounded border border-border bg-bg-2 px-2 text-xs text-fg outline-none focus:border-accent" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2">
          <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={matchCase} onChange={(event) => { setMatchCase(event.currentTarget.checked); setPage(0); }} />Match case</label>
          <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={wholeWords} onChange={(event) => { setWholeWords(event.currentTarget.checked); setPage(0); }} />Whole words</label>
        </div>
        <p className="text-[11px] text-fg-3">{matchCount} matches in {matched.length} editable captions · {selectedCount ? "selected captions" : "all captions"}</p>
        <Button label={selectedCount ? "Replace in selected captions" : "Replace in all captions"} onClick={replaceMatches}
          isDisabled={disabled || matchCount === 0} variant="secondary" size="sm" className="min-h-10 w-full justify-center" />
        {findText && <button type="button" onClick={() => { setFindText(""); setPage(0); }} className="min-h-8 text-xs text-accent">Clear search</button>}
        <p className="text-[10px] leading-relaxed text-fg-3">Timing and styling stay the same. Locked tracks are skipped.</p>
        {resultMessage && <p role="status" className="text-[11px] text-accent">{resultMessage}</p>}
      </section>}
      <Card variant="muted" padding={3} className="space-y-2 border border-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Text type="supporting" weight="bold" className="block text-[11px] text-fg">
              Single-line captions
            </Text>
            <Text type="supporting" color="secondary" className="block text-[9px]">
              Split each cue into timed clips for vertical video.
            </Text>
          </div>
          <Selector
            label="Maximum words per caption"
            isLabelHidden
            size="sm"
            width={84}
            value={String(maxWordsPerLine)}
            onChange={(value) => onMaxWordsPerLineChange(Number(value))}
            options={Array.from({ length: 10 }, (_, index) => ({
              label: String(index + 2),
              value: String(index + 2),
            }))}
          />
        </div>
        <Button
          label={
            selectedCount > 0
              ? `Make ${selectedCount} selected single-line`
              : `Make all ${captions.length} single-line`
          }
          icon={<WrapText size={13} aria-hidden />}
          variant="secondary"
          size="sm"
          isDisabled={targets.length === 0 || disabled}
          onClick={splitSelectionIntoSingleLines}
          className="w-full justify-center"
        />
      </Card>

      {captions.length === 0 ? (
        <Text type="supporting" color="secondary" className="block py-3 text-center text-[10px]">
          Import SRT/VTT or transcribe the selected clip to create editable caption text.
        </Text>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-[10px] font-semibold text-accent hover:underline"
            >
              {allSelected ? "Clear selection" : findText ? "Select matching" : "Select all"}
            </button>
            <Text type="supporting" color="secondary" className="text-[9px]">
              {captions.length} editable text clip{captions.length === 1 ? "" : "s"}
            </Text>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {visibleCaptions.map((caption) => {
              const index = captions.indexOf(caption);
              const locked = lockedTracks.has(caption.trackId);
              const selected = selectedIds.has(caption.id);
              return (
                <Card
                  key={caption.id}
                  variant="muted"
                  padding={2}
                  className={`border ${selected ? "border-accent/60 bg-accent-soft" : "border-border"}`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      aria-label={`${selected ? "Deselect" : "Select"} caption ${index + 1}`}
                      aria-pressed={selected}
                      disabled={locked || disabled}
                      onClick={() => toggleCaption(caption.id)}
                      className={`grid h-8 w-8 place-items-center rounded border disabled:opacity-40 ${
                        selected
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-bg-1 text-transparent"
                      }`}
                    >
                      <Check size={11} aria-hidden />
                    </button>
                    <button type="button" aria-label={`Go to caption ${index + 1}`} disabled={playbackLocked || exporting}
                      onClick={() => { const timeline = useTimelineStore.getState(); timeline.pause(); timeline.seekTo(caption.startTime); timeline.scrollToPlayhead(); }}
                      className="min-h-8 font-mono text-[10px] text-accent hover:underline disabled:opacity-40">
                      {formatFrameTimecode(caption.startTime, project.settings.frameRate)}
                    </button>
                  </div>
                  <textarea
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
                    className="w-full resize-y rounded-md border border-border bg-bg-1 px-2 py-1.5 text-[11px] leading-relaxed text-fg outline-none focus:border-accent"
                  />
                  {locked && <p className="text-[10px] text-fg-3">Track locked</p>}
                </Card>
              );
            })}
          </div>
          {filtered.length === 0 && <p className="text-xs text-fg-3">No captions match this search.</p>}
          {pageCount > 1 && <div className="flex items-center justify-between gap-2 text-[11px] text-fg-2" aria-label="Caption pages">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="min-h-10 px-2 text-accent disabled:opacity-40">Previous</button>
            <span>{currentPage + 1} / {pageCount} · {filtered.length} captions</span>
            <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} className="min-h-10 px-2 text-accent disabled:opacity-40">Next</button>
          </div>}
        </>
      )}
    </div>
  );
};

export default CaptionEditorPanel;
