import type { TransitionType } from "../types/effects";

const CENTER = () => ({ x: 0.5, y: 0.5 });
const border = () => ({ borderWidth: 0, borderColor: "#ffffff" });
/** The settings every mask transition (iris, band, barn door, clock, gradient, checker, inset, wedge, random) shares. */
const mask = (own: Record<string, unknown>, feather = 0): Record<string, unknown> => ({ ...own, feather, ...border(), reverse: false });

/** Read transition defaults without initializing a renderer or allocating canvases. */
export function getDefaultTransitionParams(type: TransitionType): Record<string, unknown> {
  switch (type) {
    case "crossfade":
      return { curve: "ease" };
    case "dipToBlack":
      return { holdDuration: 0.1 };
    case "dipToWhite":
      return { holdDuration: 0.1 };
    case "wipe":
      return { direction: "left", softness: 0 };
    case "slide":
      return { direction: "left", pushOut: false };
    case "zoom":
      return { scale: 2, center: { x: 0.5, y: 0.5 } };
    case "push":
      return { direction: "left" };
    case "circleReveal":
      return { center: { x: 0.5, y: 0.5 } };
    case "blur":
      return { intensity: 1 };
    case "whipPan":
      return { direction: "left", blurIntensity: 1 };
    case "radialWipe":
      return { startAngle: -90, clockwise: true };
    case "pixelate":
      return { maxPixelSize: 48 };
    case "glitch":
      return { intensity: 0.08, slices: 12 };
    case "blinds":
      return { count: 8, direction: "vertical" };
    case "diamondReveal":
      return { center: { x: 0.5, y: 0.5 } };
    case "spin":
      return { rotations: 1 };
    case "flip":
      return { axis: "horizontal" };
    case "splitReveal":
      return { orientation: "horizontal" };
    case "flash":
      return { intensity: 1 };
    case "filmBurn":
      return { intensity: 1, warmth: 0.75 };
    case "mosaic":
      return { tiles: 8, randomness: 0.85 };
    case "ripple":
      return { amplitude: 0.04, waves: 3 };
    case "pageTurn":
      return { direction: "left", shadow: 0.55 };
    case "colorSplit":
      return { maxOffset: 18, angle: 0 };
    case "irisRound":
    case "irisBox":
    case "irisCross":
    case "irisDiamond":
      return mask({ center: CENTER() });
    case "bandWipe":
      return mask({ bands: 5, orientation: "horizontal" });
    case "barnDoor":
      return mask({ orientation: "horizontal" });
    case "clockWipe":
      return mask({ startAngle: 0, clockwise: true, center: CENTER() });
    case "gradientWipe":
      return mask({ gradient: "linear" }, 0.1);
    case "cubeSpin":
    case "flipOver":
      return { direction: "left", ...border() };
    case "crossZoom":
      return { center: CENTER(), intensity: 1 };
    case "pagePeel":
      return { corner: "bottomRight", shadow: 0.55 };
    case "split":
      return { orientation: "horizontal", reverse: false, ...border() };
    case "checkerboard":
      return mask({ tiles: 8 });
    case "checkerWipe":
      return mask({ tiles: 8, direction: "left" });
    case "inset":
      return mask({ corner: "topLeft" });
    case "wedgeWipe":
      return mask({ startAngle: 0, center: CENTER() });
    case "randomBlocks":
      return mask({ tiles: 12, seed: 1 });
    case "randomWipe":
      return mask({ tiles: 12, seed: 1, direction: "left" });
    case "morphCut":
      return { quality: "medium", curve: "linear" };
    case "filmDissolve":
    case "additiveDissolve":
    default:
      return {};
  }
}
