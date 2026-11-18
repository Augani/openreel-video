import {
  planSidecarFiles,
  subtitlesForRange,
  type CaptionExportSettings,
  type SidecarFile,
  type Subtitle,
} from "@openreel/core";

/** Sidecar caption files an export asks for (range-shifted like the video). */
export function sidecarFilesFor(
  subtitles: readonly Subtitle[],
  captions: CaptionExportSettings | undefined,
  options: { baseName: string; frameRate: number; range?: { startTime: number; endTime: number } },
): SidecarFile[] {
  return planSidecarFiles(subtitlesForRange(subtitles, options.range), captions, {
    baseName: options.baseName,
    frameRate: options.frameRate,
  });
}

function browserDownload(file: SidecarFile): void {
  const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Save each sidecar file: the desktop app asks where (next to the video), the browser downloads.
 * Returns the filenames written.
 */
export async function saveCaptionSidecars(files: readonly SidecarFile[]): Promise<string[]> {
  const saved: string[] = [];
  const fs = typeof window !== "undefined" ? window.openreel?.fs : undefined;
  for (const file of files) {
    if (fs?.showSaveDialog && fs.openWrite) {
      const ext = file.filename.split(".").pop() ?? "txt";
      const chosen = await fs.showSaveDialog({
        defaultPath: file.filename,
        filters: [{ name: "Caption file", extensions: [ext] }],
      });
      if (!chosen) continue;
      const handle = await fs.openWrite(chosen);
      await fs.writeChunk(handle, file.bytes, 0);
      await fs.closeWrite(handle);
    } else browserDownload(file);
    saved.push(file.filename);
  }
  return saved;
}
