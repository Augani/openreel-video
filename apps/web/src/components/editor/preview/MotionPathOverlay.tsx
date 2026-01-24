import React, { useCallback, useMemo, useState } from "react";
import type { GSAPMotionPathPoint, MotionPathConfig } from "@openreel/core";
import { generateBezierPath } from "@openreel/core";
import { MotionPathHandles } from "./MotionPathHandles";

interface MotionPathOverlayProps {
  config: MotionPathConfig;
  canvasWidth: number;
  canvasHeight: number;
  currentTime: number;
  clipDuration: number;
  onPointMove: (index: number, x: number, y: number) => void;
  onPointAdd: (point: GSAPMotionPathPoint) => void;
  onPointRemove: (index: number) => void;
  onControlPointMove: (
    pointIndex: number,
    handleType: "cp1" | "cp2",
    x: number,
    y: number
  ) => void;
  disabled?: boolean;
}

export const MotionPathOverlay: React.FC<MotionPathOverlayProps> = ({
  config,
  canvasWidth,
  canvasHeight,
  currentTime,
  clipDuration,
  onPointMove,
  onPointAdd,
  onPointRemove,
  onControlPointMove,
  disabled = false,
}) => {
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  const screenPoints = useMemo(() => {
    return config.points.map((point) => ({
      ...point,
      screenX: canvasWidth / 2 + point.x,
      screenY: canvasHeight / 2 + point.y,
      controlPoints: point.controlPoints
        ? {
            cp1: {
              x: canvasWidth / 2 + point.controlPoints.cp1.x,
              y: canvasHeight / 2 + point.controlPoints.cp1.y,
            },
            cp2: {
              x: canvasWidth / 2 + point.controlPoints.cp2.x,
              y: canvasHeight / 2 + point.controlPoints.cp2.y,
            },
          }
        : undefined,
    }));
  }, [config.points, canvasWidth, canvasHeight]);

  const svgPath = useMemo(() => {
    if (screenPoints.length < 2) return "";

    const pathPoints: GSAPMotionPathPoint[] = screenPoints.map((p) => ({
      x: p.screenX,
      y: p.screenY,
      time: p.time,
      controlPoints: p.controlPoints,
    }));

    return generateBezierPath(pathPoints);
  }, [screenPoints]);

  const currentPosition = useMemo(() => {
    if (config.points.length === 0 || clipDuration <= 0) return null;

    const normalizedTime = currentTime / clipDuration;
    const sortedPoints = [...screenPoints].sort((a, b) => a.time - b.time);

    if (normalizedTime <= sortedPoints[0].time) {
      return { x: sortedPoints[0].screenX, y: sortedPoints[0].screenY };
    }

    if (normalizedTime >= sortedPoints[sortedPoints.length - 1].time) {
      const last = sortedPoints[sortedPoints.length - 1];
      return { x: last.screenX, y: last.screenY };
    }

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      if (
        normalizedTime >= sortedPoints[i].time &&
        normalizedTime <= sortedPoints[i + 1].time
      ) {
        const p0 = sortedPoints[i];
        const p1 = sortedPoints[i + 1];
        const segmentDuration = p1.time - p0.time;
        const t =
          segmentDuration > 0
            ? (normalizedTime - p0.time) / segmentDuration
            : 0;

        if (p0.controlPoints && p1.controlPoints) {
          return cubicBezierPoint(
            { x: p0.screenX, y: p0.screenY },
            p0.controlPoints.cp2,
            p1.controlPoints.cp1,
            { x: p1.screenX, y: p1.screenY },
            t
          );
        }

        return {
          x: p0.screenX + (p1.screenX - p0.screenX) * t,
          y: p0.screenY + (p1.screenY - p0.screenY) * t,
        };
      }
    }

    return null;
  }, [screenPoints, currentTime, clipDuration, config.points.length]);

  const handlePathClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      if (disabled) return;

      const svg = e.currentTarget.closest("svg");
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const worldX = x - canvasWidth / 2;
      const worldY = y - canvasHeight / 2;

      let insertTime = 0.5;
      if (screenPoints.length >= 2) {
        let minDist = Infinity;
        let bestTime = 0.5;

        for (let i = 0; i < screenPoints.length - 1; i++) {
          const p0 = screenPoints[i];
          const p1 = screenPoints[i + 1];

          const dx = p1.screenX - p0.screenX;
          const dy = p1.screenY - p0.screenY;
          const len = Math.sqrt(dx * dx + dy * dy);

          if (len === 0) continue;

          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - p0.screenX) * dx + (y - p0.screenY) * dy) / (len * len)
            )
          );

          const projX = p0.screenX + t * dx;
          const projY = p0.screenY + t * dy;
          const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);

          if (dist < minDist) {
            minDist = dist;
            bestTime = p0.time + t * (p1.time - p0.time);
          }
        }

        insertTime = bestTime;
      }

      onPointAdd({
        x: worldX,
        y: worldY,
        time: insertTime,
      });
    },
    [canvasWidth, canvasHeight, screenPoints, onPointAdd, disabled]
  );

  const handlePointSelect = useCallback((index: number) => {
    setSelectedPoint((prev) => (prev === index ? null : index));
  }, []);

  if (!config.enabled || !config.showPath) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={canvasWidth}
      height={canvasHeight}
      style={{ overflow: "visible" }}
    >
      <defs>
        <marker
          id="motion-path-arrow"
          markerWidth="6"
          markerHeight="6"
          refX="3"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="#22d3ee" />
        </marker>
      </defs>

      {svgPath && (
        <>
          <path
            d={svgPath}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeDasharray="6 3"
            opacity="0.8"
            className="pointer-events-auto cursor-crosshair"
            onClick={handlePathClick}
          />

          <path
            d={svgPath}
            fill="none"
            stroke="transparent"
            strokeWidth="16"
            className="pointer-events-auto cursor-crosshair"
            onClick={handlePathClick}
          />
        </>
      )}

      <MotionPathHandles
        points={screenPoints}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        selectedPoint={selectedPoint}
        hoveredPoint={hoveredPoint}
        disabled={disabled}
        onPointSelect={handlePointSelect}
        onPointHover={setHoveredPoint}
        onPointMove={(index: number, screenX: number, screenY: number) => {
          const worldX = screenX - canvasWidth / 2;
          const worldY = screenY - canvasHeight / 2;
          onPointMove(index, worldX, worldY);
        }}
        onPointRemove={onPointRemove}
        onControlPointMove={(pointIndex: number, handleType: "cp1" | "cp2", screenX: number, screenY: number) => {
          const worldX = screenX - canvasWidth / 2;
          const worldY = screenY - canvasHeight / 2;
          onControlPointMove(pointIndex, handleType, worldX, worldY);
        }}
      />

      {currentPosition && (
        <g transform={`translate(${currentPosition.x}, ${currentPosition.y})`}>
          <circle r="8" fill="#22d3ee" opacity="0.3" />
          <circle r="5" fill="#22d3ee" />
          <circle r="3" fill="white" />
        </g>
      )}

      {screenPoints.map((point, index) => (
        <text
          key={`label-${index}`}
          x={point.screenX + 12}
          y={point.screenY - 12}
          fill="white"
          fontSize="10"
          fontFamily="system-ui"
          className="pointer-events-none select-none"
        >
          {(point.time * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  );
};

function cubicBezierPoint(
  p0: { x: number; y: number },
  cp1: { x: number; y: number },
  cp2: { x: number; y: number },
  p1: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const oneMinusT = 1 - t;
  const oneMinusT2 = oneMinusT * oneMinusT;
  const oneMinusT3 = oneMinusT2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      oneMinusT3 * p0.x +
      3 * oneMinusT2 * t * cp1.x +
      3 * oneMinusT * t2 * cp2.x +
      t3 * p1.x,
    y:
      oneMinusT3 * p0.y +
      3 * oneMinusT2 * t * cp1.y +
      3 * oneMinusT * t2 * cp2.y +
      t3 * p1.y,
  };
}

export default MotionPathOverlay;
