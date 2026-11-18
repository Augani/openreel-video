import React, { useRef, useState } from "react";
import { Captions, Download, Scissors, Volume2, Proportions, Loader2 } from "@/icons/lucide-compat";
import { Button } from "@openreel/ui";
import { getMediaItemCapabilities } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { toast } from "../../stores/notification-store";
import { splitTimelineItem, trimTimelineItemToPlayhead } from "../../utils/timeline-item-actions";
import { canQuickEditAtPlayhead } from "./quick-edit";

interface QuickEditBarProps {
  clipId: string;
  onCleanAudio: () => Promise<void>;
  isCleaningAudio: boolean;
}

export const QuickEditBar: React.FC<QuickEditBarProps> = ({
  clipId, onCleanAudio, isCleaningAudio,
}) => {
  const project = useProjectStore((state) => state.project);
  const track = project.timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  const media = project.mediaLibrary.items.find((candidate) => candidate.id === clip?.mediaId);
  const capabilities = getMediaItemCapabilities(media);
  const canEditHere = useTimelineStore((state) => Boolean(clip &&
    canQuickEditAtPlayhead(clip, state.playheadPosition, project.settings.frameRate)));
  const playbackLocked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const applyingEffect = useUIStore((state) => state.effectApplicationClipId !== null);
  const [busy, setBusy] = useState(false);
  const editingRef = useRef(false);

  if (!clip || !track) return null;

  const disabled = track.locked || busy || exporting || playbackLocked || applyingEffect;
  const unavailableSource = media?.isPlaceholder || (!media?.blob && !media?.fileHandle);
  const openSection = (sectionId: string) => {
    useInspectorNavigationStore.getState().requestSection(sectionId, clipId);
  };
  const runEdit = async (operation: "split" | "trimStart" | "trimEnd") => {
    const store = useProjectStore.getState();
    const selectedIds = useUIStore.getState().getSelectedClipIds();
    const currentTrack = store.project.timeline.tracks.find((candidate) => candidate.clips.some((item) => item.id === clipId));
    const currentClip = currentTrack?.clips.find((item) => item.id === clipId);
    const timeline = useTimelineStore.getState();
    if (editingRef.current || !currentClip || currentTrack?.locked ||
      selectedIds.length !== 1 || selectedIds[0] !== clipId ||
      useUIStore.getState().exportState.isExporting ||
      useUIStore.getState().effectApplicationClipId !== null || timeline.playbackLockedReason ||
      !canQuickEditAtPlayhead(currentClip, timeline.playheadPosition, store.project.settings.frameRate)) return;
    const projectId = store.project.id;
    const time = timeline.playheadPosition;
    const label = operation === "split" ? "Split clip" : operation === "trimStart" ? "Trim clip start" : "Trim clip end";
    editingRef.current = true;
    setBusy(true);
    timeline.pause();
    store.beginHistoryGroup(label);
    try {
      const success = operation === "split"
        ? await splitTimelineItem(store, clipId, time)
        : await trimTimelineItemToPlayhead(store, clipId, time, operation === "trimStart");
      if (!success) throw new Error("The edit could not be applied. Try moving the playhead inside the clip.");
    } catch (error) {
      toast.error(`${label} failed`, error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (useProjectStore.getState().project.id === projectId) store.endHistoryGroup();
      editingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="Quick edit" className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3">
      <h3 className="text-sm font-semibold text-fg">Quick edit</h3>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-fg-3">
        {track.locked ? "Unlock this track to edit the clip." : canEditHere
          ? "Trim at the playhead, then finish your video."
          : "Move the playhead inside this clip to split or trim."}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 145px), 1fr))" }}>
        <Button onClick={() => void runEdit("split")} type="button" aria-label="Split here" disabled={(disabled || !canEditHere)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Scissors size={14} aria-hidden />}</span>
          <span className="truncate">{"Split here"}</span>
        </Button>
        <Button title="Remove the part before the playhead" onClick={() => void runEdit("trimStart")} type="button" aria-label="Trim start" disabled={(disabled || !canEditHere)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="truncate">{"Trim start"}</span>
        </Button>
        <Button title="Remove the part after the playhead" onClick={() => void runEdit("trimEnd")} type="button" aria-label="Trim end" disabled={(disabled || !canEditHere)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="truncate">{"Trim end"}</span>
        </Button>
        {capabilities.audio && <Button onClick={() => openSection("auto-captions")} type="button" aria-label="Add captions" disabled={(disabled || unavailableSource)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Captions size={14} aria-hidden />}</span>
          <span className="truncate">{"Add captions"}</span>
        </Button>}
        {capabilities.audio && <Button onClick={() => { if (!disabled) void onCleanAudio(); }} type="button" aria-label={(isCleaningAudio ? "Cleaning…" : "Clean audio").trim() || undefined} disabled={(disabled || isCleaningAudio || unavailableSource)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isCleaningAudio ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Volume2 size={14} aria-hidden />}</span>
          <span className="truncate">{isCleaningAudio ? "Cleaning…" : "Clean audio"}</span>
        </Button>}
        {media?.type === "video" && <Button onClick={() => openSection("auto-reframe")} type="button" aria-label="Reframe" disabled={(disabled || unavailableSource)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg min-h-11 w-full justify-center text-xs">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Proportions size={14} aria-hidden />}</span>
          <span className="truncate">{"Reframe"}</span>
        </Button>}
        <Button onClick={() => useUIStore.getState().openModal("export")} type="button" aria-label="Export video" disabled={(exporting || playbackLocked)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 bg-accent text-accent-fg hover:bg-accent/90 min-h-11 w-full justify-center text-xs">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Download size={14} aria-hidden />}</span>
          <span className="truncate">{"Export video"}</span>
        </Button>
      </div>
      {busy && <p role="status" className="mt-2 text-xs text-fg-3">Applying edit…</p>}
    </section>
  );
};
