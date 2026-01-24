import React, { useMemo } from "react";
import type { EasingType } from "@openreel/core";
import { EASING_FUNCTIONS, type EasingName } from "@openreel/core";

interface EasingCurveProps {
  startX: number;
  endX: number;
  easing: EasingType;
  color: string;
  height: number;
}

export const EasingCurve: React.FC<EasingCurveProps> = ({
  startX,
  endX,
  easing,
  color,
  height,
}) => {
  const pathData = useMemo(() => {
    const width = endX - startX;
    if (width <= 0) return "";

    const easingMap: Record<string, EasingName> = {
      "linear": "linear",
      "ease-in": "easeInQuad",
      "ease-out": "easeOutQuad",
      "ease-in-out": "easeInOutQuad",
      "bezier": "easeInOutCubic",
    };

    const easingName = easingMap[easing] || (easing as EasingName);
    const easingFn = EASING_FUNCTIONS[easingName] || EASING_FUNCTIONS.linear;

    const padding = 4;
    const curveHeight = height - padding * 2;
    const points: string[] = [];

    const SAMPLES = Math.min(32, Math.max(8, Math.floor(width / 4)));

    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const x = t * width;
      const easedValue = easingFn(t);
      const y = padding + curveHeight * (1 - easedValue);

      if (i === 0) {
        points.push(`M ${x} ${y}`);
      } else {
        points.push(`L ${x} ${y}`);
      }
    }

    return points.join(" ");
  }, [startX, endX, easing, height]);

  const width = endX - startX;
  if (width <= 0) return null;

  return (
    <svg
      className="absolute top-0 pointer-events-none"
      style={{
        left: startX,
        width,
        height,
      }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke={color}
        strokeWidth="1"
        opacity="0.2"
      />

      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default EasingCurve;
