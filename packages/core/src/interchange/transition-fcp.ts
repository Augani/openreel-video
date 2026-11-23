import type { TransitionType } from "../types/effects";

/** The nearest built-in Final Cut Pro transition, named in the export report (FCPXML itself carries a cross dissolve). */
export const FCP_CLOSEST: Partial<Record<TransitionType, string>> = {
  filmDissolve: "Cross Dissolve",
  additiveDissolve: "Flash",
  irisRound: "Circle",
  irisBox: "Inset",
  irisCross: "Cross",
  irisDiamond: "Diamond",
  bandWipe: "Band",
  barnDoor: "Center",
  clockWipe: "Clock",
  gradientWipe: "Gradient",
  radialWipe: "Radial",
  blinds: "Venetian Blinds",
  checkerboard: "Checkerboard",
  checkerWipe: "Checker",
  inset: "Inset",
  wedgeWipe: "Radial",
  randomBlocks: "Random",
  randomWipe: "Random",
  split: "Doors",
  cubeSpin: "Cube",
  flipOver: "Flip",
  crossZoom: "Cross Zoom",
  pagePeel: "Page Curl",
  pageTurn: "Page Curl",
};
