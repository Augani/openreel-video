/**
 * Dissolve and dip transitions composed in linear light on the float HDR image.
 *
 * The 8-bit transition engine blends sRGB codes on a canvas. In HDR working mode the same transitions are planned
 * as float layer draws: each step is a clip drawn with an opacity, or a flat colour laid over the image. Because
 * the compositor's "over" runs in scene-linear light, a crossfade between two highlights at 1000 nits passes
 * through the linear average (not a gamma-space blend that dims the middle), and nothing is clipped to SDR white.
 */

export type HdrTransitionKind = "crossfade" | "dipToBlack" | "dipToWhite";

export const HDR_TRANSITION_KINDS: readonly string[] = ["crossfade", "dipToBlack", "dipToWhite"];

export function isHdrTransitionKind(type: string): type is HdrTransitionKind {
  return HDR_TRANSITION_KINDS.includes(type);
}

export type HdrTransitionStep =
  | { readonly layer: "outgoing" | "incoming"; readonly opacity: number }
  | { readonly layer: "solid"; readonly color: "black" | "white"; readonly opacity: number };

export interface HdrTransitionPlanInput {
  readonly kind: HdrTransitionKind;
  /** Eased progress 0..1. */
  readonly progress: number;
  /** Dip only: relative length of the held colour (the 8-bit engine's `holdDuration`). */
  readonly holdDuration?: number;
  /**
   * Edge transitions have one clip: it fades in ("in") or out ("out") against what lies beneath it. Absent for a
   * cut between two clips.
   */
  readonly edge?: "in" | "out";
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The draws, in order, that make up one frame of a transition. */
export function planHdrTransition(input: HdrTransitionPlanInput): HdrTransitionStep[] {
  const p = clamp01(input.progress);
  if (input.kind === "crossfade") {
    if (input.edge === "in") return [{ layer: "incoming", opacity: p }];
    if (input.edge === "out") return [{ layer: "outgoing", opacity: 1 - p }];
    // Outgoing at full strength with the incoming clip mixed over it by p: B*p + A*(1-p), alpha 1.
    return [
      { layer: "outgoing", opacity: 1 },
      { layer: "incoming", opacity: p },
    ];
  }
  const color = input.kind === "dipToWhite" ? "white" : "black";
  const hold = Math.max(0, input.holdDuration ?? 0);
  const phases = 2 + hold;
  const fadeOutEnd = 1 / phases;
  const holdEnd = (1 + hold) / phases;
  if (p < fadeOutEnd) {
    const t = p / fadeOutEnd;
    return [
      { layer: "outgoing", opacity: 1 },
      { layer: "solid", color, opacity: t },
    ];
  }
  if (p < holdEnd) return [{ layer: "solid", color, opacity: 1 }];
  const t = (p - holdEnd) / (1 - holdEnd);
  return [
    { layer: "solid", color, opacity: 1 },
    { layer: "incoming", opacity: t },
  ];
}
