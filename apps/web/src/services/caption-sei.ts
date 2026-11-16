import { exportCaptionFile } from "@openreel/core/captions/caption-formats";
import { CaptionSeiError, embedCea608Sei } from "@openreel/core/export/caption-sei-embed";
import type { Subtitle } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";

/**
 * File > Embed CEA-608 captions in video...: write the project's captions into the H.264 stream
 * of an already exported MP4 / MOV (A/53 SEI, the broadcast way). Nothing is re-encoded: the
 * file is copied bit for bit and only the captioned frames grow by a few bytes. Works in the
 * browser and in the desktop app because it is a plain byte-level pass.
 */

const MAX_BYTES = 1_500_000_000; // the pass holds the file in memory

const baseName = (name: string): string => name.replace(/\.[^./\\]+$/, "");

/** The caption track to embed: the first track that has cues (the default track is ""). */
export function pickCaptionTrack(subtitles: readonly Subtitle[]): { captionTrackId: string; cues: number } | null {
  const counts = new Map<string, number>();
  for (const cue of subtitles) {
    if (cue.endTime <= cue.startTime || !cue.text.trim()) continue;
    const id = cue.captionTrackId ?? "";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const first = [...counts.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))[0];
  return first ? { captionTrackId: first[0], cues: first[1] } : null;
}

export async function embedCaptionsInFile(file: File): Promise<void> {
  const project = useProjectStore.getState().getFullProject();
  const subtitles = project.timeline.subtitles ?? [];
  const track = pickCaptionTrack(subtitles);
  if (!track) {
    toast.warning("No captions to embed", "Add or generate captions first, then embed them in the exported video.");
    return;
  }
  if (file.size > MAX_BYTES) {
    toast.error("File too large to embed", "CEA-608 embedding processes the file in memory and supports files up to 1.5 GB.");
    return;
  }
  try {
    const scc = exportCaptionFile(subtitles, "scc", { captionTrackId: track.captionTrackId, frameRate: project.settings.frameRate });
    const result = await embedCea608Sei({
      source: file,
      scc: new TextDecoder().decode(scc.bytes),
      frameRate: project.settings.frameRate,
    });
    const extension = /\.mov$/i.test(file.name) ? "mov" : "mp4";
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName(file.name)}-cc608.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const notes = [...scc.issues.filter((issue) => issue.severity !== "info").map((issue) => issue.message), ...result.warnings];
    toast.success(
      "CEA-608 captions embedded",
      `${result.framesWithCaptions} of ${result.videoFrames} frames carry caption data (${track.cues} cue${track.cues === 1 ? "" : "s"}). Picture and audio are unchanged.${notes.length ? ` ${notes.join(" ")}` : ""}`,
    );
  } catch (error) {
    toast.error(
      "Could not embed CEA-608 captions",
      error instanceof CaptionSeiError || error instanceof Error ? error.message : "The file could not be processed.",
    );
  }
}

/** File > Embed CEA-608 captions in video...: pick the exported MP4 / MOV, then embed. */
export function openCea608Embed(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".mp4,.mov,.m4v,video/mp4,video/quicktime";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void embedCaptionsInFile(file);
  });
  document.body.appendChild(input);
  input.click();
}
