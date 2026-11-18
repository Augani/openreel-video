import {
  analyzeBusLoudness,
  createCachedMixdownRenderer,
  exportBusStems,
  getAudioEngine,
  planStems,
  type StemMode,
  type LoudnessAnalysis,
  type RenderedStem,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

export interface StemExportRequest {
  /** What to split the mix by; default buses. */
  readonly mode?: StemMode;
  /** Source ids for `mode` (bus ids, track ids or audio types); default all that carry audio. */
  readonly ids?: readonly string[];
  readonly busIds?: readonly string[];
  readonly bitDepth?: 16 | 24;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

/** Renders the requested bus stems (default: every bus carrying audio) through the export mixdown. */
export function renderProjectStems(request: StemExportRequest = {}): Promise<RenderedStem[]> {
  const project = useProjectStore.getState().getFullProject();
  return exportBusStems(project, createCachedMixdownRenderer(getAudioEngine()), {
    mode: request.mode,
    ids: request.ids,
    busIds: request.busIds,
    bitDepth: request.bitDepth,
    signal: request.signal,
    onProgress: request.onProgress,
  });
}

/** What an export would write, without rendering. */
export function previewStemPlan(busIds?: readonly string[], mode: StemMode = "bus") {
  return planStems(useProjectStore.getState().getFullProject(), { mode, ids: busIds });
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Renders every stem and hands each WAV to the browser as a download, one after another. */
export async function exportStemsAsDownloads(request: StemExportRequest = {}): Promise<RenderedStem[]> {
  const stems = await renderProjectStems(request);
  for (const stem of stems) {
    saveBlob(new Blob([stem.wav as unknown as ArrayBuffer], { type: "audio/wav" }), stem.fileName);
    // Browsers throttle bursts of programmatic downloads; spacing them keeps every file.
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return stems;
}

/** Offline BS.1770 loudness of one bus's stem (its post-fader output over the whole timeline). */
export function analyzeBusLoudnessNow(
  busId: string,
  options: { signal?: AbortSignal } = {},
): Promise<LoudnessAnalysis> {
  const project = useProjectStore.getState().getFullProject();
  return analyzeBusLoudness(project, busId, createCachedMixdownRenderer(getAudioEngine()), { signal: options.signal });
}
