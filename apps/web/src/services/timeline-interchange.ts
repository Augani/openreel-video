import { create } from "zustand";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import {
  exportTimeline,
  importTimelineFile,
  applyTimelineImport,
  type ExportReport,
  type ImportableFormat,
  type InterchangeFormat,
  type TimelineImportMode,
  type TimelineImportResult,
} from "@openreel/core/interchange/index";
import { useProjectStore } from "../stores/project-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { toast } from "../stores/notification-store";

export const EXPORT_LABELS: Record<InterchangeFormat, string> = {
  xmeml: "Timeline XML (Premiere/Resolve)",
  fcpxml: "FCPXML (Final Cut)",
  edl: "EDL",
  otio: "OpenTimelineIO",
  aaf: "AAF (Avid/Premiere/Resolve)",
};

export interface InterchangeExportReportView {
  readonly format: InterchangeFormat;
  readonly label: string;
  readonly filenames: string[];
  readonly report: ExportReport;
}

interface ExportReportState {
  view: InterchangeExportReportView | null;
  setView: (view: InterchangeExportReportView | null) => void;
}

/** Drives the "Export report" dialog shown after an interchange export. */
export const useInterchangeExportReportStore = create<ExportReportState>((set) => ({
  view: null,
  setView: (view) => set({ view }),
}));

/** Plain-text copy of a report (for the Copy button and bug reports). */
export function formatExportReport(view: InterchangeExportReportView): string {
  const lines = [
    `${view.label} export: ${view.filenames.join(", ")}`,
    `${view.report.dropped} dropped, ${view.report.approximated} approximated`,
    "",
  ];
  for (const item of view.report.items) {
    const where = [item.trackName, item.clipName].filter(Boolean).join(" / ");
    lines.push(`[${item.severity}] ${item.feature}${where ? ` (${where})` : ""}: ${item.detail}`);
  }
  for (const note of view.report.notes) lines.push(`[note] ${note}`);
  return lines.join("\n");
}

function download(filename: string, mimeType: string, content: string | Uint8Array): void {
  const blob =
    typeof content === "string"
      ? new Blob([content], { type: `${mimeType};charset=utf-8` })
      : new Blob([content as unknown as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ExportPickerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Write the project's markers into exported timelines (File > Export timeline and the picker). */
  includeMarkers: boolean;
  setIncludeMarkers: (include: boolean) => void;
}

/** Drives the "choose a sequence and a format" export dialog. */
export const useInterchangeExportPickerStore = create<ExportPickerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  includeMarkers: true,
  setIncludeMarkers: (includeMarkers) => set({ includeMarkers }),
}));

/** File > Export timeline > Timeline XML / FCPXML / EDL / OpenTimelineIO / AAF. Any sequence, the active one by default. */
export function exportTimelineInterchange(format: InterchangeFormat, sequenceId?: string): void {
  try {
    const project = useProjectStore.getState().getFullProject();
    const result = exportTimeline(project, format, {
      includeMarkers: useInterchangeExportPickerStore.getState().includeMarkers,
      targetedTrackIds: useEditorWorkspaceStore.getState().targetedTrackIds,
      ...(sequenceId ? { sequenceId } : {}),
    });
    for (const file of result.files) download(file.filename, file.mimeType, file.bytes ?? file.content);
    const names = result.files.map((f) => f.filename).join(", ");
    if (result.report.items.length > 0) {
      // Nothing is dropped silently: show exactly what was left out or approximated.
      useInterchangeExportReportStore.getState().setView({
        format,
        label: EXPORT_LABELS[format],
        filenames: result.files.map((f) => f.filename),
        report: result.report,
      });
    } else {
      toast.success(`${EXPORT_LABELS[format]} exported`, `${names}. Nothing was dropped.`);
    }
  } catch (error) {
    toast.error("Could not export the timeline", error instanceof Error ? error.message : undefined);
  }
}

export interface PrprojSequenceChoice {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly nested: boolean;
}

export interface TimelineImportPreview {
  readonly filename: string;
  readonly result: TimelineImportResult & { format: ImportableFormat };
  /** .prproj only: every sequence of the file, the selected one, and a way to re-read another one. */
  readonly prproj?: {
    readonly sequences: readonly PrprojSequenceChoice[];
    readonly selectedId: string;
    readonly select: (id: string) => TimelineImportPreview;
  };
}

interface TimelineImportState {
  preview: TimelineImportPreview | null;
  setPreview: (preview: TimelineImportPreview | null) => void;
}

export const useTimelineImportStore = create<TimelineImportState>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

const isPrprojName = (name: string): boolean => /\.prproj$/i.test(name);

/** A .prproj import preview (Premiere project); the parser is loaded on demand, it is not part of the editor's first load. */
async function previewPrproj(filename: string, bytes: Uint8Array): Promise<TimelineImportPreview> {
  const core = await import("@openreel/core/interchange/prproj");
  const doc = await core.readPrproj(bytes);
  const project = useProjectStore.getState().project;
  const build = (sequenceId?: string): TimelineImportPreview => {
    const result = core.importPrprojDocument(doc, {
      mediaItems: project.mediaLibrary.items,
      frameRate: project.settings.frameRate,
      ...(sequenceId ? { sequenceId } : {}),
    });
    return {
      filename,
      result,
      prproj: {
        selectedId: result.prproj.selectedId,
        sequences: result.prproj.sequences.map((s) => ({
          id: s.id,
          name: s.name,
          nested: s.nested,
          detail: `${s.width}x${s.height} · ${Number(s.fps.toFixed(3))} fps · ${s.clipCount} clips`,
        })),
        select: (id) => build(id),
      },
    };
  };
  return build();
}

/** Parse a timeline file (.prproj, AAF binary, or xmeml / FCPXML / OTIO text) against the current media bin. */
export async function previewTimelineFile(filename: string, bytes: Uint8Array): Promise<TimelineImportPreview> {
  if (isPrprojName(filename) || (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) return previewPrproj(filename, bytes);
  const project = useProjectStore.getState().project;
  const result = importTimelineFile(bytes, { mediaItems: project.mediaLibrary.items, frameRate: project.settings.frameRate });
  return { filename, result };
}

/** Read a timeline file the user picked or dropped and open the import dialog (errors become a toast). */
export async function openTimelineFileForImport(file: File): Promise<void> {
  try {
    const buffer = await file.arrayBuffer();
    useTimelineImportStore.getState().setPreview(await previewTimelineFile(file.name, new Uint8Array(buffer)));
  } catch (error) {
    toast.error("Could not read the timeline file", error instanceof Error ? error.message : undefined);
  }
}

export const isPremiereProjectFile = isPrprojName;

/** File > Import timeline > Timeline XML… / AAF… — pick a file, then show the relink report. */
export function openTimelineImport(kind: "xml" | "aaf" | "prproj" = "xml"): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept =
    kind === "aaf"
      ? ".aaf,application/octet-stream"
      : kind === "prproj"
        ? ".prproj"
        : ".xml,.fcpxml,.otio,.edl,.aaf,.prproj,text/xml,application/xml,application/json,application/octet-stream";
  input.dataset.testid = "timeline-import-input";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void openTimelineFileForImport(file);
  });
  document.body.appendChild(input);
  input.click();
}

/** Commit an import as ONE undoable `project/applyEditSnapshot` action. */
export async function commitTimelineImport(
  result: TimelineImportResult,
  mode: TimelineImportMode,
): Promise<{ success: boolean; message?: string }> {
  const store = useProjectStore.getState();
  const full = store.getFullProject();
  // Includes one project sequence per compound clip the file carried (FCPXML ref-clip).
  const snapshot = editSnapshot(applyTimelineImport(full, result, mode));
  const outcome = await store.executeAction({
    type: "project/applyEditSnapshot",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { snapshot },
  });
  if (outcome.success && result.targetedTrackIds?.length) {
    // The file said which tracks were targeted; mirror that in the editor's targeting state.
    const keep = mode === "append" ? useEditorWorkspaceStore.getState().targetedTrackIds : [];
    useEditorWorkspaceStore.setState({ targetedTrackIds: [...keep, ...result.targetedTrackIds] });
  }
  return { success: outcome.success, message: outcome.error?.message };
}
