/**
 * Files the desktop app registers with the operating system (File > Open With, double-click, `OpenReel file.srt`).
 * One list drives the open-file routing, the electron-builder `fileAssociations` and the tests that keep the two
 * in step. Pure: no electron import.
 */
export const PROJECT_EXTENSIONS = [".oreel"] as const;
/** Caption formats the editor imports (core/captions/caption-import). */
export const CAPTION_EXTENSIONS = [".srt", ".vtt", ".scc", ".mcc", ".stl", ".ttml", ".dfxp"] as const;

export type OpenFileKind = "project" | "captions";
export interface OpenFileItem {
  kind: OpenFileKind;
  /** Absolute path. */
  path: string;
}

export interface FileAssociation {
  ext: string;
  name: string;
  description: string;
  role: "Editor" | "Viewer";
  /** macOS Launch Services rank: a project file is ours; a caption file is one of several apps' (never take over .srt). */
  rank: "Owner" | "Alternate";
  mimeType: string;
}

export const FILE_ASSOCIATIONS: readonly FileAssociation[] = [
  { ext: "oreel", name: "OpenReel Project", description: "OpenReel project", role: "Editor", rank: "Owner", mimeType: "application/vnd.openreel.project+json" },
  { ext: "srt", name: "SubRip Captions", description: "SubRip (.srt) captions", role: "Viewer", rank: "Alternate", mimeType: "application/x-subrip" },
  { ext: "vtt", name: "WebVTT Captions", description: "WebVTT captions", role: "Viewer", rank: "Alternate", mimeType: "text/vtt" },
  { ext: "scc", name: "Scenarist Closed Captions", description: "SCC closed captions", role: "Viewer", rank: "Alternate", mimeType: "text/x-scc" },
  { ext: "mcc", name: "MacCaption Closed Captions", description: "MCC closed captions", role: "Viewer", rank: "Alternate", mimeType: "text/x-mcc" },
  { ext: "stl", name: "EBU STL Subtitles", description: "EBU STL subtitles", role: "Viewer", rank: "Alternate", mimeType: "application/x-ebu-stl" },
  { ext: "ttml", name: "TTML Captions", description: "TTML timed text captions", role: "Viewer", rank: "Alternate", mimeType: "application/ttml+xml" },
  { ext: "dfxp", name: "DFXP Captions", description: "DFXP timed text captions", role: "Viewer", rank: "Alternate", mimeType: "application/ttaf+xml" },
];

const extensionOf = (filePath: string): string => {
  const base = filePath.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
};

/** What opening this file means, or null for a file the app is not associated with. */
export function classifyOpenFile(filePath: string): OpenFileKind | null {
  const ext = extensionOf(filePath);
  if ((PROJECT_EXTENSIONS as readonly string[]).includes(ext)) return "project";
  if ((CAPTION_EXTENSIONS as readonly string[]).includes(ext)) return "captions";
  return null;
}
