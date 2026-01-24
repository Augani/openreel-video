import React, { useCallback, useState, useEffect, useRef } from "react";

interface ScreenPoint {
  x: number;
  y: number;
  time: number;
  screenX: number;
  screenY: number;
  controlPoints?: {
    cp1: { x: number; y: number };
    cp2: { x: number; y: number };
  };
}

interface MotionPathHandlesProps {
  points: ScreenPoint[];
  canvasWidth: number;
  canvasHeight: number;
  selectedPoint: number | null;
  hoveredPoint: number | null;
  disabled: boolean;
  onPointSelect: (index: number) => void;
  onPointHover: (index: number | null) => void;
  onPointMove: (index: number, screenX: number, screenY: number) => void;
  onPointRemove: (index: number) => void;
  onControlPointMove: (
    pointIndex: number,
    handleType: "cp1" | "cp2",
    screenX: number,
    screenY: number
  ) => void;
}

interface DragState {
  type: "point" | "cp1" | "cp2";
  pointIndex: number;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
}

export const MotionPathHandles: React.FC<MotionPathHandlesProps> = ({
  points,
  canvasWidth: _canvasWidth,
  canvasHeight: _canvasHeight,
  selectedPoint,
  hoveredPoint,
  disabled,
  onPointSelect,
  onPointHover,
  onPointMove,
  onPointRemove,
  onControlPointMove,
}) => {
  void _canvasWidth;
  void _canvasHeight;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const svgRef = useRef<SVGGElement>(null);

  const handleMouseDown = useCallback(
    (
      e: React.MouseEvent,
      type: "point" | "cp1" | "cp2",
      pointIndex: number,
      initialX: number,
      initialY: number
    ) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      setDragState({
        type,
        pointIndex,
        startX: e.clientX,
        startY: e.clientY,
        initialX,
        initialY,
      });

      if (type === "point") {
        onPointSelect(pointIndex);
      }
    },
    [disabled, onPointSelect]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;
      const newX = dragState.initialX + deltaX;
      const newY = dragState.initialY + deltaY;

      if (dragState.type === "point") {
        onPointMove(dragState.pointIndex, newX, newY);
      } else {
        onControlPointMove(dragState.pointIndex, dragState.type, newX, newY);
      }
    },
    [dragState, onPointMove, onControlPointMove]
  );

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  useEffect(() => {
    if (dragState) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      if (points.length > 2) {
        onPointRemove(index);
      }
    },
    [points.length, onPointRemove]
  );

  return (
    <g ref={svgRef}>
      {points.map((point, index) => {
        const isSelected = selectedPoint === index;
        const isHovered = hoveredPoint === index;
        const showHandles = isSelected && point.controlPoints;

        return (
          <g key={`point-${index}`}>
            {showHandles && point.controlPoints && (
              <>
                <line
                  x1={point.controlPoints.cp1.x}
                  y1={point.controlPoints.cp1.y}
                  x2={point.screenX}
                  y2={point.screenY}
                  stroke="#a855f7"
                  strokeWidth="1"
                  opacity="0.6"
                />
                <line
                  x1={point.screenX}
                  y1={point.screenY}
                  x2={point.controlPoints.cp2.x}
                  y2={point.controlPoints.cp2.y}
                  stroke="#a855f7"
                  strokeWidth="1"
                  opacity="0.6"
                />

                <circle
                  cx={point.controlPoints.cp1.x}
                  cy={point.controlPoints.cp1.y}
                  r="5"
                  fill="#a855f7"
                  stroke="white"
                  strokeWidth="1"
                  className="cursor-move pointer-events-auto"
                  onMouseDown={(e) =>
                    handleMouseDown(
                      e,
                      "cp1",
                      index,
                      point.controlPoints!.cp1.x,
                      point.controlPoints!.cp1.y
                    )
                  }
                />
                <circle
                  cx={point.controlPoints.cp2.x}
                  cy={point.controlPoints.cp2.y}
                  r="5"
                  fill="#a855f7"
                  stroke="white"
                  strokeWidth="1"
                  className="cursor-move pointer-events-auto"
                  onMouseDown={(e) =>
                    handleMouseDown(
                      e,
                      "cp2",
                      index,
                      point.controlPoints!.cp2.x,
                      point.controlPoints!.cp2.y
                    )
                  }
                />
              </>
            )}

            <g
              transform={`translate(${point.screenX}, ${point.screenY}) rotate(45)`}
              className="pointer-events-auto cursor-move"
              onMouseDown={(e) =>
                handleMouseDown(e, "point", index, point.screenX, point.screenY)
              }
              onMouseEnter={() => onPointHover(index)}
              onMouseLeave={() => onPointHover(null)}
              onContextMenu={(e) => handleContextMenu(e, index)}
            >
              <rect
                x="-7"
                y="-7"
                width="14"
                height="14"
                fill={isSelected ? "#22d3ee" : isHovered ? "#67e8f9" : "white"}
                stroke={isSelected ? "white" : "#22d3ee"}
                strokeWidth="2"
                rx="2"
              />

              {index === 0 && (
                <text
                  transform="rotate(-45)"
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fill={isSelected ? "white" : "#22d3ee"}
                  fontSize="8"
                  fontWeight="bold"
                  className="pointer-events-none select-none"
                >
                  S
                </text>
              )}
              {index === points.length - 1 && index !== 0 && (
                <text
                  transform="rotate(-45)"
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fill={isSelected ? "white" : "#22d3ee"}
                  fontSize="8"
                  fontWeight="bold"
                  className="pointer-events-none select-none"
                >
                  E
                </text>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
};

export default MotionPathHandles;
