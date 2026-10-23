/**
 * Remembers the last browser export so it can be saved to the Director's Eyes library afterwards.
 * Called by export-runner just before it hands the file to the browser download. OPFS temp files are
 * deleted about a minute later, so the bytes are copied into memory right away (only when signed in
 * and within the library limit — otherwise nothing is kept).
 */
import { create } from "zustand";
import { HAWSH_LIBRARY_MAX_BYTES } from "./config";
import { useHawshStore } from "./session";

interface LastExportState { blob: Blob | null; filename: string | null; at: number | null }
export const useLastExport = create<LastExportState>(() => ({ blob: null, filename: null, at: null }));

export function rememberExport(data: Blob, filename: string, mime?: string): void {
  if (useHawshStore.getState().status !== "ready") return;
  if (data.size <= 0 || data.size > HAWSH_LIBRARY_MAX_BYTES) return;
  void data.arrayBuffer().then(
    (buf) => useLastExport.setState({ blob: new Blob([buf], { type: mime || data.type }), filename, at: Date.now() }),
    () => undefined,
  );
}

export function clearLastExport(): void {
  useLastExport.setState({ blob: null, filename: null, at: null });
}
