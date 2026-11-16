import { useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@openreel/ui";
import { getMediaItemCapabilities } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useEditorWorkspaceStore, type AssetSection } from "../../../stores/editor-workspace-store";
import { useInspectorNavigationStore } from "../../../stores/inspector-navigation-store";
import { getEditableTimelineSelection } from "../../../utils/linked-timeline-selection";
import { getTimelineItemRanges } from "../../../utils/timeline-item-actions";
import { editTimelineSelection } from "../../../services/linked-timeline-edit";
import { toast } from "../../../stores/notification-store";
import { canResetClipTransform, resetClipTransform } from "../../../services/reset-clip-transform";
import { MobileToolDock } from "./MobileToolDock";
import { MobileToolsSheet } from "./MobileToolsSheet";
import type { MobileToolId } from "./mobile-tools";
import "./mobile-tools.css";

type CompactPanel = "timeline" | "media" | "inspector" | "chat";
const inspectorSections: Partial<Record<MobileToolId, string>> = {
  trim: "transform", speed: "speed", volume: "clip-audio", animate: "keyframes", crop: "crop",
  filters: "color-grading", reverse: "speed", freeze: "speed-curves", noise: "background-noise-removal",
  silence: "auto-cut-silence", cutout: "background-removal", vertical: "auto-reframe", enhance: "clip-audio",
};
const assetSections: Partial<Record<MobileToolId, AssetSection>> = {
  audio: "audio", music: "audio", sfx: "audio", voiceover: "audio", text: "text", captions: "text",
  effects: "effects", transitions: "transitions", media: "media", graphics: "graphics", generate: "ai", recipes: "recipes", settings: "settings",
};

export function MobileEditorTools({ onPanel }: { onPanel: (panel: CompactPanel) => void }) {
  const project = useProjectStore(s => s.project);
  const selection = useUIStore(s => s.selectedItems);
  const exporting = useUIStore(s => s.exportState.isExporting);
  const applyingEffect = useUIStore(s => s.effectApplicationClipId !== null);
  const playbackLocked = useTimelineStore(s => !!s.playbackLockedReason);
  const linked = useEditorWorkspaceStore(s => s.linkedSelection);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dismissedSelection, setDismissedSelection] = useState<typeof selection | null>(null);
  const [recent, setRecent] = useState<MobileToolId[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const replacementInput = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState<{ projectId: string; mediaId: string; name: string; uses: number; accept: string } | null>(null);
  const fullProject = useMemo(() => {
    const current = useProjectStore.getState();
    return current.project === project ? current.getFullProject() : project;
  }, [project]);
  const ids = useMemo(() => selection.filter(item => ["clip", "text-clip", "shape-clip"].includes(item.type)).map(item => item.id), [selection]);
  const ranges = useMemo(() => getTimelineItemRanges(fullProject), [fullProject]);
  const selected = ranges.find(item => item.id === ids[0]);
  const track = project.timeline.tracks.find(item => item.id === selected?.trackId);
  const clip = track?.clips.find(item => item.id === selected?.id);
  const media = project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
  const capabilities = getMediaItemCapabilities(media);
  const editable = useMemo(() => getEditableTimelineSelection(fullProject, ids, linked), [fullProject, ids, linked]);
  const editableRanges = useMemo(() => {
    const editableIds = new Set(editable.ids);
    return ranges.filter(item => editableIds.has(item.id));
  }, [ranges, editable.ids]);
  // Playback ticks inspect only this selection and publish only boundary changes.
  const canSplit = useTimelineStore(s => editableRanges.some(item => s.playheadPosition > item.startTime && s.playheadPosition < item.startTime + item.duration));
  const selectedTrackLocked = useMemo(() => {
    const selectedIds = new Set(ids), lockedTracks = new Set(project.timeline.tracks.filter(t => t.locked).map(t => t.id));
    return ranges.some(item => selectedIds.has(item.id) && lockedTracks.has(item.trackId));
  }, [ids, project.timeline.tracks, ranges]);
  const blocked = busy || exporting || applyingEffect || playbackLocked || editable.blocked || selectedTrackLocked;
  const oneMedia = ids.length === 1 && !!clip;
  const visual = ids.length === 1 && !!selected && (selected.kind !== "media" || media?.type === "video" || media?.type === "image");
  const hasAudio = oneMedia && (track?.type === "audio" || capabilities.audio);
  const resettable = ids.length === 1 && canResetClipTransform(useProjectStore.getState(), ids[0]);
  const unavailable = useMemo(() => {
    const result: MobileToolId[] = [];
    if (blocked || !ids.length) result.push("split", "trim", "delete", "duplicate");
    if (blocked || !resettable) result.push("reset-transform");
    if (!canSplit) result.push("split");
    if (blocked || !oneMedia || !["video", "audio"].includes(media?.type ?? "")) result.push("speed", "reverse");
    if (blocked || !oneMedia || media?.type !== "video") result.push("freeze", "cutout", "vertical");
    if (blocked || !hasAudio) result.push("volume", "noise", "silence", "enhance");
    if (blocked || !visual) result.push("animate");
    if (blocked || !oneMedia || !visual) result.push("filters");
    if (blocked || !oneMedia || !visual) result.push("crop");
    if (blocked || !oneMedia || !media || project.timeline.tracks.some(t => t.locked && t.clips.some(c => c.mediaId === media.id))) result.push("replace");
    return result;
  }, [blocked, ids.length, canSplit, oneMedia, media, hasAudio, visual, project.timeline.tracks, resettable]);
  let selectionTitle: string | undefined;
  if (ids.length > 1) selectionTitle = `${ids.length} clips selected`;
  else if (selected) {
    const siblings = ranges.filter(item => item.trackId === selected.trackId).sort((a, b) => a.startTime - b.startTime);
    const text = fullProject.textClips?.find(item => item.id === selected.id)?.text;
    selectionTitle = `Clip ${siblings.findIndex(item => item.id === selected.id) + 1} of ${siblings.length} · ${media?.name ?? text ?? track?.name ?? "Graphic"}`;
  }

  const onTool = (id: MobileToolId) => {
    if (unavailable.includes(id)) return;
    if (id === "find" || id === "edit") { setToolsOpen(true); return; }
    setRecent(previous => [id, ...previous.filter(item => item !== id)].slice(0, 4));
    if (id === "timeline" || id === "chat" || id === "inspector") { onPanel(id); return; }
    if (id === "reset-transform") {
      const currentIds = useUIStore.getState().getSelectedClipIds();
      if (useProjectStore.getState().project.id === project.id && currentIds.length === 1 && currentIds[0] === ids[0]) void resetClipTransform(currentIds[0]);
      return;
    }
    if (id === "captions") {
      const workspace = useEditorWorkspaceStore.getState();
      workspace.setSection("text"); workspace.setTextSource("captions"); workspace.setMobileCaptionsOpen(true);
      onPanel("timeline"); return;
    }
    const asset = assetSections[id];
    if (asset) {
      const workspace = useEditorWorkspaceStore.getState();
      workspace.setSection(asset);
      if (asset === "audio") workspace.setAudioSource(id === "sfx" ? "sfx" : id === "voiceover" ? "voiceover" : "music");
      if (asset === "text") workspace.setTextSource("text");
      onPanel("media");
      return;
    }
    const section = inspectorSections[id];
    if (section && ids[0]) {
      useInspectorNavigationStore.getState().requestSection(section, ids[0]);
      onPanel("inspector");
      return;
    }
    if (id === "replace" && media) {
      setReplacement({ projectId: project.id, mediaId: media.id, name: media.name, uses: project.timeline.tracks.flatMap(t => t.clips).filter(c => c.mediaId === media.id).length, accept: `${media.type}/*` });
      return;
    }
    if (id === "split" || id === "delete" || id === "duplicate") void runEdit(id);
  };
  const runEdit = async (operation: "split" | "delete" | "duplicate") => {
    const ui = useUIStore.getState(), timeline = useTimelineStore.getState();
    const currentIds = ui.getSelectedClipIds();
    if (busyRef.current || ui.exportState.isExporting || ui.effectApplicationClipId !== null || timeline.playbackLockedReason) return;
    if (useProjectStore.getState().project.id !== project.id || currentIds.length !== ids.length || currentIds.some((id, index) => id !== ids[index])) return;
    busyRef.current = true; setBusy(true); timeline.pause();
    try {
      const edited = await editTimelineSelection(currentIds, operation, timeline.playheadPosition);
      if (edited && operation === "delete") useUIStore.getState().clearSelection();
    } catch (error) { toast.error("Could not edit clips", error instanceof Error ? error.message : "Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const replaceSource = async (file?: File) => {
    if (!file || !replacement || busyRef.current) return;
    const current = useProjectStore.getState();
    if (current.project.id !== replacement.projectId || current.project.timeline.tracks.some(t => t.locked && t.clips.some(c => c.mediaId === replacement.mediaId))) return;
    const ui = useUIStore.getState();
    if (ui.exportState.isExporting || ui.effectApplicationClipId !== null || useTimelineStore.getState().playbackLockedReason) return;
    busyRef.current = true; setBusy(true);
    useTimelineStore.getState().pause();
    try {
      const result = await current.replaceMediaAsset(replacement.mediaId, file);
      if (!result.success) throw new Error(result.error?.message ?? "Try another media file.");
      setReplacement(null);
    } catch (error) { toast.error("Could not replace media", error instanceof Error ? error.message : "Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <>
    <MobileToolDock selectionTitle={dismissedSelection === selection ? undefined : selectionTitle} onTool={onTool} unavailable={unavailable}
      onBack={() => { setDismissedSelection(selection); onPanel("timeline"); }} onDone={() => { useUIStore.getState().clearSelection(); onPanel("timeline"); }}/>
    <MobileToolsSheet open={toolsOpen} onOpenChange={setToolsOpen} onTool={onTool} unavailable={unavailable} recent={recent}/>
    <Dialog open={replacement !== null} onOpenChange={open => { if (!open && !busyRef.current) setReplacement(null); }}>
      <DialogContent>
        <DialogTitle>Replace source media</DialogTitle>
        <DialogDescription>Every clip that uses {replacement?.name} will use the new file ({replacement?.uses} {replacement?.uses === 1 ? "clip" : "clips"}).</DialogDescription>
        <Input ref={replacementInput} aria-label="Replacement media file" type="file" accept={replacement?.accept} className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void replaceSource(file); }}/>
        <Button disabled={busy} onClick={() => replacementInput.current?.click()}>{busy ? "Replacing…" : "Choose replacement"}</Button>
      </DialogContent>
    </Dialog>
  </>;
}
