import type { TransitionType } from "../types/effects";
import { getDefaultTransitionParams } from "../video/transition-default-params";

/**
 * How OpenReel's transitions are named in other editors. Premiere Pro's built-in transitions are identified by their
 * effect name in Premiere / FCP7 XML (xmeml) and are written under those names; OTIO carries the name next to
 * OpenReel's own type so a round trip is exact. Types with no entry (glitch, ripple, ...) have no equivalent and
 * are written as a cross dissolve and reported as approximated.
 */
export interface TransitionName {
  /** Premiere Pro's transition name. */
  readonly name: string;
  /** Premiere Pro's transition bin (xmeml `effectcategory`). */
  readonly category: string;
}

export const TRANSITION_NAMES: Partial<Record<TransitionType, TransitionName>> = {
  filmDissolve: { name: "Film Dissolve", category: "Dissolve" },
  additiveDissolve: { name: "Additive Dissolve", category: "Dissolve" },
  irisRound: { name: "Iris Round", category: "Iris" },
  irisBox: { name: "Iris Box", category: "Iris" },
  irisCross: { name: "Iris Cross", category: "Iris" },
  irisDiamond: { name: "Iris Diamond", category: "Iris" },
  bandWipe: { name: "Band Wipe", category: "Wipe" },
  barnDoor: { name: "Barn Doors", category: "Wipe" },
  clockWipe: { name: "Clock Wipe", category: "Wipe" },
  gradientWipe: { name: "Gradient Wipe", category: "Wipe" },
  radialWipe: { name: "Radial Wipe", category: "Wipe" },
  blinds: { name: "Venetian Blinds", category: "Wipe" },
  checkerboard: { name: "Checkerboard", category: "Wipe" },
  checkerWipe: { name: "Checker Wipe", category: "Wipe" },
  inset: { name: "Inset", category: "Wipe" },
  wedgeWipe: { name: "Wedge Wipe", category: "Wipe" },
  randomBlocks: { name: "Random Blocks", category: "Wipe" },
  randomWipe: { name: "Random Wipe", category: "Wipe" },
  split: { name: "Split", category: "Slide" },
  cubeSpin: { name: "Cube Spin", category: "3D Motion" },
  flipOver: { name: "Flip Over", category: "3D Motion" },
  crossZoom: { name: "Cross Zoom", category: "Zoom" },
  pagePeel: { name: "Page Peel", category: "Page Peel" },
  pageTurn: { name: "Page Turn", category: "Page Peel" },
  morphCut: { name: "Morph Cut", category: "Dissolve" },
};

const BY_NAME = new Map<string, TransitionType>(
  Object.entries(TRANSITION_NAMES).map(([type, entry]) => [entry!.name.toLowerCase(), type as TransitionType]),
);
BY_NAME.set("barn door", "barnDoor");

/** The transition a Premiere transition name stands for, or null when it is not one OpenReel has. */
export function transitionTypeFromName(name: string): TransitionType | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

const NOT_CARRIED = new Set(["alignment", "curve", "audioFade"]);

/** Whether a transition's settings differ from its defaults, i.e. whether a format that carries only the name loses something. */
export function hasCustomSettings(type: TransitionType, params: Record<string, unknown>): boolean {
  const defaults = getDefaultTransitionParams(type) as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    if (NOT_CARRIED.has(key) || value === undefined) continue;
    if (JSON.stringify(value) !== JSON.stringify(defaults[key])) return true;
  }
  return false;
}
