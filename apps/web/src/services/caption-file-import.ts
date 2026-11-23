import type { CaptionFormatIssue } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";

/**
 * Caption files brought in from the Project panel (picker or drop) and File > Import captions...:
 * SRT, WebVTT, SBV, TTML / DFXP / iTT, SCC, MCC and EBU-STL. The parsers load on demand. Every file
 * is one undo step. What the format carries that OpenReel's caption model cannot hold is listed in
 * the notification, never dropped silently.
 */

export const CAPTION_FILE_ACCEPT = ".srt,.vtt,.sbv,.ttml,.dfxp,.itt,.scc,.mcc,.stl";

const baseName = (name: string): string => name.replace(/\.[^./\\]+$/, "");

/** Notes, most serious first, capped so a notification stays readable. */
export function summariseImportNotes(
  skipped: readonly string[] | undefined,
  issues: readonly CaptionFormatIssue[] | undefined,
  max = 5,
): { text: string | undefined; problems: number } {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const notes = [
    ...(skipped ?? []).map((m) => ({ severity: "warning" as const, message: `Skipped: ${m}` })),
    ...(issues ?? []),
  ].sort((a, b) => rank[a.severity] - rank[b.severity]);
  if (!notes.length) return { text: undefined, problems: 0 };
  const shown = notes.slice(0, max).map((n) => n.message);
  const extra = notes.length - shown.length;
  return {
    text: [...shown, ...(extra > 0 ? [`...and ${extra} more note${extra === 1 ? "" : "s"} (see the Transcript panel after importing again from there).`] : [])].join("\n"),
    problems: notes.filter((n) => n.severity !== "info").length,
  };
}

/** Import caption files; returns how many cues were added in total. */
export async function importCaptionFiles(files: readonly File[]): Promise<number> {
  const { importCaptionBytes } = await import("./transcript-commands");
  let total = 0;
  for (const file of files) {
    const existing = useProjectStore.getState().project.timeline.subtitles ?? [];
    // A second file must not pile onto the first one's track: give it its own track named after the file.
    const needsTrack = existing.some((cue) => (cue.captionTrackId ?? "") === "");
    const trackId = needsTrack ? baseName(file.name) : undefined;
    const outcome = await importCaptionBytes(new Uint8Array(await file.arrayBuffer()), {
      fileName: file.name,
      ...(trackId ? { captionTrackId: trackId } : {}),
    });
    const notes = summariseImportNotes(outcome.errors, outcome.issues);
    if (!outcome.success) {
      toast.error(`Could not import ${file.name}`, [outcome.message, notes.text].filter(Boolean).join("\n"));
      continue;
    }
    total += outcome.added ?? 0;
    const title = `Imported ${outcome.added} caption${outcome.added === 1 ? "" : "s"} from ${file.name}${trackId ? ` (track "${trackId}")` : ""}`;
    if (notes.problems) toast.warning(title, notes.text);
    else toast.success(title, notes.text);
  }
  return total;
}

/** File > Import captions...: pick caption files, then import them. */
export function openCaptionImport(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = CAPTION_FILE_ACCEPT;
  input.multiple = true;
  input.dataset.testid = "caption-import-input";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    input.remove();
    if (files.length) void importCaptionFiles(files);
  });
  document.body.appendChild(input);
  input.click();
}
