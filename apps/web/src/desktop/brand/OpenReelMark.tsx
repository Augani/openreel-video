import type { JSX } from "react";

const VIEWBOX = 64;
const CENTER = VIEWBOX / 2;
const SPOKE_INNER = 15;
const SPOKE_OUTER = 24;
const SPOKE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

type Spoke = { x1: number; y1: number; x2: number; y2: number };

function buildSpokes(): readonly Spoke[] {
  return SPOKE_ANGLES.map((angle) => {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x1: CENTER + SPOKE_INNER * cos,
      y1: CENTER + SPOKE_INNER * sin,
      x2: CENTER + SPOKE_OUTER * cos,
      y2: CENTER + SPOKE_OUTER * sin,
    };
  });
}

const SPOKES = buildSpokes();

export function OpenReelMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}): JSX.Element {
  const dimension = Number.isFinite(size) && size > 0 ? size : 24;
  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="OpenReel"
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={22}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.2}
      />
      <g stroke="currentColor" strokeWidth={4} strokeLinecap="round">
        {SPOKES.map((spoke, index) => (
          <line key={index} x1={spoke.x1} y1={spoke.y1} x2={spoke.x2} y2={spoke.y2} />
        ))}
      </g>
      <circle cx={CENTER} cy={CENTER} r={9} fill="currentColor" />
    </svg>
  );
}
