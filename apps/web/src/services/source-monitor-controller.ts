import { useProjectStore } from "../stores/project-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { stepEditingFrame, normalizeEditingFrameRate } from "../components/editor/editing-frame-rate";
import {
  insertFromSource,
  overwriteFromSource,
} from "./source-monitor-commands";
import { addSourceMarker } from "./clip-marker-commands";
import { runWithToast } from "./premiere-edit-commands";

/**
 * Keyboard/transport logic for the Source monitor, independent of the DOM so
 * the global shortcut router and the on-screen buttons share one code path.
 */
export interface SourceMediaInfo {
  mediaId: string;
  duration: number;
  frameRate: number;
}

export function getSourceMediaInfo(): SourceMediaInfo | null {
  const { mediaId } = useSourceMonitorStore.getState();
  if (!mediaId) return null;
  const { project } = useProjectStore.getState();
  const media = project.mediaLibrary.items.find((m) => m.id === mediaId);
  if (!media) return null;
  return {
    mediaId,
    duration: media.metadata.duration > 0 ? media.metadata.duration : 5,
    frameRate: normalizeEditingFrameRate(media.metadata.frameRate || project.settings.frameRate),
  };
}

export function seekSource(seconds: number): void {
  const info = getSourceMediaInfo();
  if (!info) return;
  const store = useSourceMonitorStore.getState();
  store.stop();
  store.setPosition(Math.min(info.duration, Math.max(0, seconds)));
}

export function stepSourceFrame(direction: -1 | 1): void {
  const info = getSourceMediaInfo();
  if (!info) return;
  const { position } = useSourceMonitorStore.getState();
  seekSource(stepEditingFrame(position, direction, info.frameRate));
}

export function seekSourceRelative(delta: number): void {
  seekSource(useSourceMonitorStore.getState().position + delta);
}

/** Mark In/Out at the source playhead, snapped to a frame. */
export function markSource(which: "in" | "out"): void {
  const info = getSourceMediaInfo();
  if (!info) return;
  const { position, setMark } = useSourceMonitorStore.getState();
  const time = Math.round(position * info.frameRate) / info.frameRate;
  setMark(info.mediaId, which, Math.min(info.duration, time));
}

export function clearSourceMarks(): void {
  const info = getSourceMediaInfo();
  if (info) useSourceMonitorStore.getState().clearMarks(info.mediaId);
}

export function goToSourceMark(which: "in" | "out"): void {
  const info = getSourceMediaInfo();
  if (!info) return;
  const marks = useSourceMonitorStore.getState().getMarks(info.mediaId);
  const target = which === "in" ? marks.in ?? 0 : marks.out ?? info.duration;
  seekSource(target);
}

const TRANSPORT_ACTIONS = new Set([
  "playback.playPause",
  "playback.shuttleBack",
  "playback.shuttleForward",
]);

/** Stills have no transport: play/shuttle do nothing (stepping still works). */
export function isSourcePlayable(): boolean {
  const { mediaId } = useSourceMonitorStore.getState();
  const media = useProjectStore
    .getState()
    .project.mediaLibrary.items.find((m) => m.id === mediaId);
  return media?.type === "video" || media?.type === "audio";
}

/** Whether global shortcuts currently belong to the Source monitor. */
export function sourceMonitorOwnsKeys(): boolean {
  const s = useSourceMonitorStore.getState();
  return s.tab === "source" && s.focus === "source" && s.mediaId !== null;
}

/**
 * Handle a resolved shortcut action for the focused Source monitor. Returns
 * true when consumed; anything else (undo, save, ...) falls through to the
 * normal handlers.
 */
export function handleSourceMonitorAction(action: string): boolean {
  if (!sourceMonitorOwnsKeys() || !getSourceMediaInfo()) return false;
  const store = useSourceMonitorStore.getState();
  if (TRANSPORT_ACTIONS.has(action) && !isSourcePlayable()) return true;
  switch (action) {
    case "playback.playPause": store.togglePlay(); return true;
    case "playback.shuttleBack": store.shuttle(-1); return true;
    case "playback.shuttleStop": store.stop(); return true;
    case "playback.shuttleForward": store.shuttle(1); return true;
    case "playback.frameBack": stepSourceFrame(-1); return true;
    case "playback.frameForward": stepSourceFrame(1); return true;
    case "playback.secondBack": seekSourceRelative(-1); return true;
    case "playback.secondForward": seekSourceRelative(1); return true;
    case "playback.jump5Back": seekSourceRelative(-5); return true;
    case "playback.jump5Forward": seekSourceRelative(5); return true;
    case "playback.goToStart": seekSource(0); return true;
    case "playback.goToEnd": seekSource(Number.POSITIVE_INFINITY); return true;
    case "playback.markLoopStart": markSource("in"); return true;
    case "playback.markLoopEnd": markSource("out"); return true;
    case "tools.addMarker":
    case "tools.addClipMarker": void addSourceMarker(); return true;
    case "editing.insert": runWithToast("Insert", () => insertFromSource()); return true;
    case "editing.overwrite": runWithToast("Overwrite", () => overwriteFromSource()); return true;
    default: return false;
  }
}
