import type { TimelineToolMode, TimelineToolPreview } from "@openreel/core";
import { formatFrameTimecode } from "../../../utils/frame-timecode";

const NAMES: Record<TimelineToolMode, string> = {
  ripple: "Ripple trim",
  slip: "Slip",
  roll: "Roll",
  slide: "Slide",
  stretch: "Rate",
};

/** Signed timecode delta, e.g. "+00:00:00:03" (a zero delta has no sign). */
export function formatSignedDelta(seconds: number, frameRate: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds * frameRate) < 0.5)
    return formatFrameTimecode(0, frameRate);
  return `${seconds < 0 ? "-" : "+"}${formatFrameTimecode(Math.abs(seconds), frameRate)}`;
}

export interface ToolReadout {
  /** Live label of the primary ghost. */
  label: string;
  /** Labels for the adjusted neighbours, in preview order. */
  neighbors: string[];
}

/**
 * Premiere-style two-up trim info: the primary clip shows the edit delta and
 * its new duration or position, every adjusted neighbour shows its new length.
 */
export function describeToolPreview(
  mode: TimelineToolMode,
  value: TimelineToolPreview,
  frameRate: number,
): ToolReadout {
  const tc = (seconds: number) => formatFrameTimecode(seconds, frameRate);
  const delta = formatSignedDelta(value.delta, frameRate);
  const name = NAMES[mode];
  const neighbors = (value.neighbors ?? (value.neighbor ? [value.neighbor] : [])).map(
    (n) => `${tc(n.duration)} · ${tc(n.startTime)}`,
  );
  switch (mode) {
    case "slip":
      return {
        label: `${name} ${delta} · ${tc(value.inPoint ?? 0)} → ${tc(value.outPoint ?? 0)}`,
        neighbors,
      };
    case "stretch":
      return {
        label: `${name} · ${Math.round((value.speed ?? 1) * 100)}% · ${delta} · ${tc(value.duration)}`,
        neighbors,
      };
    case "slide":
      return { label: `${name} ${delta} · in ${tc(value.startTime)}`, neighbors };
    default:
      return { label: `${name} ${delta} · ${tc(value.duration)}`, neighbors };
  }
}
