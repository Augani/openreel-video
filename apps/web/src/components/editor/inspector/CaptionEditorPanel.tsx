import React, { useEffect, useMemo, useState } from "react";
import { splitCaptionIntoSingleLineCues } from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import { Check, WrapText } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";

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
          .filter((track) => track.type === "text" && track.name === "Captions")
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

  useEffect(() => {
    setDrafts(
      Object.fromEntries(captions.map((caption) => [caption.id, caption.text])),
    );
    setSelectedIds((current) => {
      const available = new Set(captions.map((caption) => caption.id));
      return new Set([...current].filter((id) => available.has(id)));
    });
  }, [captions]);

  const selectedCount = selectedIds.size;
  const allSelected = captions.length > 0 && selectedCount === captions.length;

  const toggleAll = () => {
    setSelectedIds(
      allSelected ? new Set() : new Set(captions.map((caption) => caption.id)),
    );
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
    if (!caption || !draft || draft === caption.text) return;
    updateTextContent(captionId, draft);
  };

  const splitSelectionIntoSingleLines = () => {
    const targets = selectedCount > 0 ? selectedIds : new Set(captions.map((clip) => clip.id));
    const history = useProjectStore.getState().actionExecutor.getHistory();
    history.beginGroup("Split captions into single lines");
    try {
      for (const caption of captions) {
        if (!targets.has(caption.id)) continue;
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

  return (
    <div className="space-y-3">
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
          isDisabled={captions.length === 0}
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
              {allSelected ? "Clear selection" : "Select all"}
            </button>
            <Text type="supporting" color="secondary" className="text-[9px]">
              {captions.length} editable text clip{captions.length === 1 ? "" : "s"}
            </Text>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {captions.map((caption, index) => {
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
                      onClick={() => toggleCaption(caption.id)}
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        selected
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-bg-1 text-transparent"
                      }`}
                    >
                      <Check size={11} aria-hidden />
                    </button>
                    <Text type="supporting" color="secondary" className="font-mono text-[9px]">
                      {caption.startTime.toFixed(1)}s–{(caption.startTime + caption.duration).toFixed(1)}s
                    </Text>
                  </div>
                  <textarea
                    aria-label={`Caption ${index + 1} text`}
                    rows={Math.max(2, (drafts[caption.id]?.split("\n").length ?? 1))}
                    value={drafts[caption.id] ?? caption.text}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [caption.id]: event.currentTarget.value,
                      }))
                    }
                    onBlur={() => commitDraft(caption.id)}
                    className="w-full resize-y rounded-md border border-border bg-bg-1 px-2 py-1.5 text-[11px] leading-relaxed text-fg outline-none focus:border-accent"
                  />
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default CaptionEditorPanel;
