/**
 * Absolute path of a picked or dropped file on desktop (Electron), or "" when the file is not backed by
 * a file on disk or the app runs on the web. Kept free of store imports so the media slice can use it.
 */
export function nativePathForFile(file: Blob): string {
  try {
    return typeof File !== "undefined" && file instanceof File ? (window.openreel?.fs.pathForFile?.(file) ?? "") : "";
  } catch {
    return "";
  }
}
