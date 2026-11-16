import {
  chaptersText,
  markersCsv,
  markersEdlLocs,
  markerFrameRate,
  markerAt,
  nextMarker,
  prevMarker,
  type Marker,
  type MarkerKind,
} from "@openreel/core";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";

/** Marker colours offered in menus and cycled by the panel (name, hex). */
export const MARKER_COLORS: readonly { name: string; value: string }[] = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Red", value: "#ef4444" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#facc15" },
  { name: "Purple", value: "#a855f7" },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Magenta", value: "#d946ef" },
  { name: "White", value: "#ffffff" },
];

export const DEFAULT_MARKER_COLOR = MARKER_COLORS[0].value;

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  comment: "Comment",
  chapter: "Chapter",
  segmentation: "Segmentation",
  web: "Web link",
};

const markers = (): readonly Marker[] => useProjectStore.getState().project.timeline.markers;
const playhead = (): number => useTimelineStore.getState().playheadPosition;

/** A press of M this close (in seconds) to an existing marker edits it instead of stacking another. */
const SAME_SPOT = 0.04;

/** Move the playhead to a marker without clamping to the clip content. */
export function seekToMarker(marker: Pick<Marker, "time">): void {
  const timeline = useTimelineStore.getState();
  timeline.pause();
  timeline.seekTo(Math.max(0, marker.time));
  useTimelineStore.getState().scrollToPlayhead();
}

export function goToNextMarker(kind?: MarkerKind): boolean {
  const next = nextMarker(markers(), playhead(), { kind });
  if (!next) return false;
  seekToMarker(next);
  return true;
}

export function goToPreviousMarker(kind?: MarkerKind): boolean {
  const prev = prevMarker(markers(), playhead(), { kind });
  if (!prev) return false;
  seekToMarker(prev);
  return true;
}

/** Open the Markers panel with this marker's row in edit mode. */
export function editMarker(markerId: string): void {
  const workspace = useEditorWorkspaceStore.getState();
  workspace.setSection("markers");
  workspace.setEditingMarkerId(markerId);
  useUIStore.getState().setPanelVisible("agentChat", false);
}

/**
 * M: add a marker at the playhead. Pressing it again on that marker (M twice)
 * opens it for editing instead of adding a duplicate.
 */
export async function addMarkerAtPlayhead(): Promise<void> {
  const time = playhead();
  const existing = markers().find((m) => Math.abs(m.time - time) <= SAME_SPOT);
  if (existing) {
    editMarker(existing.id);
    return;
  }
  await useProjectStore
    .getState()
    .addMarker(time, `Marker ${markers().length + 1}`, DEFAULT_MARKER_COLOR);
}

/** Alt+M: edit the marker at (or the nearest one before) the playhead. */
export function editMarkerAtPlayhead(): void {
  const list = markers();
  const target = markerAt(list, playhead()) ?? prevMarker(list, playhead());
  if (!target) {
    toast.info("No marker to edit", "Press M to add a marker at the playhead.");
    return;
  }
  editMarker(target.id);
}

export async function clearMarkerAtPlayhead(): Promise<void> {
  const target = markerAt(markers(), playhead());
  if (!target) {
    toast.info("No marker at the playhead");
    return;
  }
  await useProjectStore.getState().removeMarker(target.id);
}

/** Remove every marker as one undo step. */
export async function clearAllMarkers(): Promise<void> {
  const store = useProjectStore.getState();
  const ids = store.project.timeline.markers.map((m) => m.id);
  if (ids.length === 0) return;
  store.beginHistoryGroup("Clear all markers");
  try {
    for (const id of ids) await useProjectStore.getState().removeMarker(id);
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}

/** Add a range marker from `start` to `end` (seconds), named after the marker count. */
export async function addRangeMarker(start: number, end: number): Promise<void> {
  const from = Math.max(0, Math.min(start, end));
  const duration = Math.abs(end - start);
  const store = useProjectStore.getState();
  await store.addMarker(from, `Marker ${store.project.timeline.markers.length + 1}`, DEFAULT_MARKER_COLOR, {
    ...(duration > 0 ? { duration } : {}),
  });
}

export type MarkerExportKind = "chapters" | "csv" | "edl";

export interface MarkerExportFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
  readonly warnings: readonly string[];
}

const safeName = (name: string): string => name.replace(/[^\w.-]+/g, "_") || "project";

/** Build one marker export (pure apart from reading the project). */
export function buildMarkerExport(kind: MarkerExportKind): MarkerExportFile {
  const { project } = useProjectStore.getState();
  const list = project.timeline.markers;
  const base = safeName(project.name);
  const fps = project.settings.frameRate || 30;
  if (kind === "chapters") {
    const result = chaptersText(list, { totalDuration: useProjectStore.getState().getTimelineDuration() });
    return { filename: `${base}_chapters.txt`, mimeType: "text/plain", content: result.text, warnings: result.warnings };
  }
  if (kind === "csv") {
    return { filename: `${base}_markers.csv`, mimeType: "text/csv", content: markersCsv(list, fps), warnings: [] };
  }
  const lines = markersEdlLocs(list, fps);
  const fcm = markerFrameRate(fps).dropFrame ? "DROP FRAME" : "NON-DROP FRAME";
  const content = [`TITLE: ${project.name || "SEQUENCE"}`, `FCM: ${fcm}`, "", ...lines, ""].join("\n");
  return { filename: `${base}_markers.edl`, mimeType: "text/plain", content, warnings: [] };
}

export function download(file: MarkerExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: `${file.mimeType};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export the project's markers as YouTube chapters, a Premiere-style CSV or EDL locators. */
export function exportMarkers(kind: MarkerExportKind): MarkerExportFile | null {
  if (markers().length === 0) {
    toast.info("No markers to export", "Press M to add a marker at the playhead.");
    return null;
  }
  const file = buildMarkerExport(kind);
  download(file);
  if (file.warnings.length > 0) toast.warning("Chapters exported with warnings", file.warnings.join(" "));
  else toast.success("Markers exported", file.filename);
  return file;
}
