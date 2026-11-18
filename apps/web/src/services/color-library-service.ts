/**
 * Colour library operations shared by the Color tab and the agent host bridge:
 * saving looks and LUTs, applying them to clips as one undo step, .cube export.
 */
import {
  createLook,
  createLutEntry,
  gradingFromLook,
  lutFromJson,
  serializeCubeLut,
  type ClipColorGrading,
  type ClipLutJson,
  type LutLibraryEntry,
  type SavedLook,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { saveLookEntry, saveLutEntry } from "./color-library";

export type LutSlot = "creative" | "input";

export const lutSlotKey = (slot: LutSlot): "lut" | "inputLut" =>
  slot === "input" ? "inputLut" : "lut";

/** Save the full grade of a clip as a named look. Throws when there is no grade. */
export async function saveLookFromClip(
  clipId: string,
  name: string,
): Promise<SavedLook> {
  const clip = useProjectStore.getState().getClip(clipId);
  const look = createLook(name, clip?.colorGrading);
  await saveLookEntry(look);
  return look;
}

/** Replace the grade of every clip with the look's. One undo step. */
export function applyLookToClips(
  look: SavedLook,
  clipIds: readonly string[],
): Promise<string[]> {
  return useProjectStore
    .getState()
    .setClipsColorGrading(clipIds, () => gradingFromLook(look), `Apply look "${look.name}"`);
}

/** Put a library LUT into the creative or Input slot of several clips. One undo step. */
export function applyLutEntryToClips(
  entry: LutLibraryEntry,
  clipIds: readonly string[],
  slot: LutSlot,
  intensity?: number,
): Promise<string[]> {
  const key = lutSlotKey(slot);
  return useProjectStore.getState().setClipsColorGrading(
    clipIds,
    (current): ClipColorGrading => ({
      // A clip's first grade uses the Premiere-order pipeline, like updateColorGrading.
      ...(current ?? { pipelineVersion: 2 as const }),
      [key]: { ...structuredClone(entry.lut), intensity: intensity ?? entry.lut.intensity },
    }),
    `Apply ${slot} LUT "${entry.name}"`,
  );
}

/** Keep an imported (or on-clip) LUT in the per-user library. */
export async function saveLutToLibrary(
  name: string,
  lut: ClipLutJson,
): Promise<LutLibraryEntry> {
  const entry = createLutEntry(name, lut);
  await saveLutEntry(entry);
  return entry;
}

/** The .cube text for a LUT, intensity baked in. */
export function cubeTextFor(lut: ClipLutJson, title: string): string {
  return serializeCubeLut(lutFromJson(lut), { title });
}

/** Hand a .cube file to the user as a download. */
export function downloadCube(filename: string, text: string): void {
  const name = /\.cube$/i.test(filename) ? filename : `${filename}.cube`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
