import type { ProjectSettings } from "../types/project";
import type { HdrTransfer } from "../export/types";
import { isHdrTransfer, type SourceColorSpace } from "./source-color";

/**
 * Sequence colour space, the Premiere-style choice made once per sequence:
 *
 *   rec709     SDR, the default and the only behaviour before this setting existed
 *   rec2100pq  HDR10: BT.2020 primaries, PQ transfer (ITU-R BT.2100)
 *   rec2100hlg HDR broadcast: BT.2020 primaries, HLG transfer (ITU-R BT.2100)
 *
 * An HDR sequence works in the half-float scene-linear Rec.2020 working mode (see color/hdr-working.ts; 1.0 = 203
 * nits), previews through the tone-mapped SDR view, exports to its own transfer by default and measures its scopes
 * in nits. The setting is only honoured together with `workingColorSpace: "rec2020"` (the project menu writes both
 * in one undoable `project/updateSettings`), so older code that reads only `workingColorSpace` stays correct.
 */
export type SequenceColorSpace = "rec709" | "rec2100pq" | "rec2100hlg";

export const SEQUENCE_COLOR_SPACES: ReadonlyArray<{ readonly value: SequenceColorSpace; readonly label: string }> = [
  { value: "rec709", label: "Rec.709 (default)" },
  { value: "rec2100pq", label: "Rec.2100 PQ (HDR10)" },
  { value: "rec2100hlg", label: "Rec.2100 HLG" },
];

type SequenceSettings = Pick<ProjectSettings, "workingColorSpace" | "sequenceColorSpace">;

export function resolveSequenceColorSpace(settings: SequenceSettings | undefined): SequenceColorSpace {
  if (settings?.workingColorSpace !== "rec2020") return "rec709";
  return settings.sequenceColorSpace === "rec2100pq" || settings.sequenceColorSpace === "rec2100hlg" ? settings.sequenceColorSpace : "rec709";
}

export function isHdrSequence(settings: SequenceSettings | undefined): boolean {
  return resolveSequenceColorSpace(settings) !== "rec709";
}

/** The HDR transfer an HDR sequence exports with by default; undefined for an SDR sequence. */
export function sequenceHdrTransfer(settings: SequenceSettings | undefined): Exclude<HdrTransfer, "none"> | undefined {
  const space = resolveSequenceColorSpace(settings);
  return space === "rec2100pq" ? "pq" : space === "rec2100hlg" ? "hlg" : undefined;
}

/** The `project/updateSettings` patch that moves a sequence to `space`. Rec.709 clears the HDR choice. */
export function sequenceColorSpacePatch(space: SequenceColorSpace): Pick<ProjectSettings, "workingColorSpace" | "sequenceColorSpace"> {
  return space === "rec709"
    ? { workingColorSpace: "rec709", sequenceColorSpace: undefined }
    : { workingColorSpace: "rec2020", sequenceColorSpace: space };
}

/**
 * HDR source detection: the sequence colour space footage with PQ / HLG tags asks for, or null when no source is HDR.
 * Mixed footage follows the majority transfer (PQ on a tie), the colour tags themselves come from container
 * metadata (`SourceColorSpace`, read by mediabunny on the web and ffprobe on the desktop).
 */
export function suggestSequenceColorSpace(
  sources: ReadonlyArray<Pick<SourceColorSpace, "transfer"> | null | undefined>,
): Exclude<SequenceColorSpace, "rec709"> | null {
  let pq = 0;
  let hlg = 0;
  for (const source of sources) {
    if (!source || !isHdrTransfer(source)) continue;
    if (source.transfer === "pq") pq++;
    else hlg++;
  }
  if (pq === 0 && hlg === 0) return null;
  return hlg > pq ? "rec2100hlg" : "rec2100pq";
}

// -- scopes ------------------------------------------------------------------------------------------------------

/** Scope level scale an HDR sequence measures in: PQ nits for HDR10, HLG nits for HLG, IRE for SDR. */
export function sequenceScopeScale(settings: SequenceSettings | undefined): "ire" | "pq" | "hlg" {
  const space = resolveSequenceColorSpace(settings);
  return space === "rec2100pq" ? "pq" : space === "rec2100hlg" ? "hlg" : "ire";
}
