import type { CueSettings, SubtitleStyle } from "../types/timeline";
import type { TextScroll, TextStyle } from "./types";

/**
 * Named, reusable looks stored on the project (`Project.savedStyles`): text
 * styles for text clips and caption styles for caption cues. Saving and
 * applying go through undoable actions (`style/*`).
 */

export interface SavedTextStyle {
  readonly id: string;
  readonly name: string;
  readonly style: TextStyle;
  /** Optional roll/crawl carried with the look. */
  readonly scroll?: TextScroll;
}

export interface SavedCaptionStyle {
  readonly id: string;
  readonly name: string;
  readonly style: SubtitleStyle;
  readonly cueSettings?: CueSettings;
}

export interface SavedStyleLibrary {
  readonly text: readonly SavedTextStyle[];
  readonly caption: readonly SavedCaptionStyle[];
}

export type SavedStyleKind = "text" | "caption";

export const EMPTY_STYLE_LIBRARY: SavedStyleLibrary = { text: [], caption: [] };

export function normalizeStyleName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Case-insensitive lookup by id or name. */
export function findSavedStyle<T extends { id: string; name: string }>(
  list: readonly T[] | undefined,
  idOrName: string,
): T | undefined {
  const wanted = idOrName.trim().toLowerCase();
  return (
    list?.find((entry) => entry.id === idOrName) ??
    list?.find((entry) => entry.name.toLowerCase() === wanted)
  );
}
