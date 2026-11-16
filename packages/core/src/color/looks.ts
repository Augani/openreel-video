/**
 * Saved looks (a clip's full Lumetri grade under a name) and LUT library
 * entries. Pure data helpers; persistence lives in the host (IndexedDB in the
 * web app) so a library is per user and reusable across projects.
 */
import type { ClipColorGrading, ClipLutJson } from "../video/color-grading-engine";
import { isNeutralColorGrading } from "../video/color-grading-defaults";
import { lutFromJson } from "./lut-json";

export interface SavedLook {
  id: string;
  name: string;
  createdAt: number;
  /** The complete grade: wheels, curves, hue curves, HSL, tone, WB, vignette, creative + input LUT. */
  grading: ClipColorGrading;
}

export interface LutLibraryEntry {
  id: string;
  name: string;
  createdAt: number;
  kind: "1d" | "3d";
  size: number;
  lut: ClipLutJson;
}

export class LookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookError";
  }
}

export function libraryId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True when a stored grade renders as nothing (so it is not worth saving as a look). */
export function isNeutralStoredGrading(grading: ClipColorGrading): boolean {
  const { lut, inputLut, ...rest } = grading;
  return isNeutralColorGrading({
    ...rest,
    lut: lut ? lutFromJson(lut) : undefined,
    inputLut: inputLut ? lutFromJson(inputLut) : undefined,
  });
}

/** Create a look from a clip's grading. Throws when the name is blank or the grade is neutral. */
export function createLook(
  name: string,
  grading: ClipColorGrading | undefined,
  options: { id?: string; now?: number } = {},
): SavedLook {
  const trimmed = name.trim();
  if (!trimmed) throw new LookError("A look needs a name.");
  if (!grading || isNeutralStoredGrading(grading))
    throw new LookError("The clip has no grade to save.");
  return {
    id: options.id ?? libraryId("look"),
    name: trimmed,
    createdAt: options.now ?? Date.now(),
    grading: structuredClone(grading),
  };
}

/** The grade to write onto a clip when applying a look (a deep copy; replaces the whole grade). */
export function gradingFromLook(look: SavedLook): ClipColorGrading {
  return structuredClone(look.grading);
}

/** Library entry for an imported LUT. */
export function createLutEntry(
  name: string,
  lut: ClipLutJson,
  options: { id?: string; now?: number } = {},
): LutLibraryEntry {
  const trimmed = name.trim();
  if (!trimmed) throw new LookError("A LUT needs a name.");
  return {
    id: options.id ?? libraryId("lut"),
    name: trimmed,
    createdAt: options.now ?? Date.now(),
    kind: lut.curve1d ? "1d" : "3d",
    size: lut.curve1d ? lut.curve1d.size : lut.size,
    lut: structuredClone(lut),
  };
}
