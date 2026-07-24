import React, {
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { RotateCcw } from "@/icons/lucide-compat";
import type { CurvesValues, CurvePoint } from "@openreel/core";

export const DEFAULT_CURVES: CurvesValues = {
  rgb: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

/**
 * Channel colors for display
 */
const CHANNEL_COLORS: Record<string, string> = {
  rgb: "#ffffff",
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6",
};

/**
 * Props for the CurvesEditor component
 */
interface CurvesEditorProps {
  values: CurvesValues;
  onChange: (values: CurvesValues) => void;
  onReset?: () => void;
}

/**
 * Channel selector tab
 */
const ChannelTab: React.FC<{
  channel: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ channel, label, isActive, onClick }) => (
  <ClickableCard
    label={`Select ${label} curve channel`}
    onClick={onClick}
    className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${
      isActive
        ? "bg-bg-2 text-fg"
        : "text-fg-3 hover:text-fg-2"
    }`}
    style={{
      borderBottom: isActive ? `2px solid ${CHANNEL_COLORS[channel]}` : "none",
    }}
  >
    {label}
  </ClickableCard>
);

/**
 * Catmull-Rom spline interpolation for smooth curves
 */
function catmullRomInterpolate(points: CurvePoint[], t: number): number {
  if (points.length < 2) return t;

  // Sort points by x
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Find the segment containing t
  let segmentIndex = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].x && t <= sorted[i + 1].x) {
      segmentIndex = i;
      break;
    }
  }

  // Get 4 control points for Catmull-Rom
  const p0 = segmentIndex > 0 ? sorted[segmentIndex - 1] : sorted[segmentIndex];
  const p1 = sorted[segmentIndex];
  const p2 = sorted[Math.min(segmentIndex + 1, sorted.length - 1)];
  const p3 = sorted[Math.min(segmentIndex + 2, sorted.length - 1)];

  // Calculate local t within segment
  const segmentT = p2.x !== p1.x ? (t - p1.x) / (p2.x - p1.x) : 0;
  const t2 = segmentT * segmentT;
  const t3 = t2 * segmentT;

  // Catmull-Rom spline formula
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * segmentT +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

  return Math.max(0, Math.min(1, y));
}

/**
 * Generate SVG path for a curve
 */
function generateCurvePath(
  points: CurvePoint[],
  width: number,
  height: number,
): string {
  if (points.length < 2) return "";

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const pathPoints: string[] = [];

  // Generate path with many interpolated points for smoothness
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = catmullRomInterpolate(sorted, t);
    const x = t * width;
    const yPos = height - y * height;
    pathPoints.push(i === 0 ? `M ${x} ${yPos}` : `L ${x} ${yPos}`);
  }

  return pathPoints.join(" ");
}

/**
 * CurvesEditor Component
 *
 * - 5.1: Display interactive curve editor with RGB master and individual channels
 * - 5.2: Interpolate smoothly between points using spline interpolation
 * - 5.3: Remap pixel values according to curve shape when dragged
 * - 5.4: Recalculate curve when points are removed
 */
export const CurvesEditor: React.FC<CurvesEditorProps> = ({
  values,
  onChange,
  onReset: _onReset,
}) => {
  void _onReset;
  const [activeChannel, setActiveChannel] = useState<keyof CurvesValues>("rgb");
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const canvasWidth = 200;
  const canvasHeight = 200;
  const padding = 8;

  // Get current channel points
  const currentPoints = useMemo(() => {
    return values[activeChannel] || DEFAULT_CURVES[activeChannel];
  }, [values, activeChannel]);

  // Handle point drag
  const handlePointDrag = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!svgRef.current || selectedPointIndex === null) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(
          1,
          (e.clientX - rect.left - padding) / (canvasWidth - 2 * padding),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          1,
          1 - (e.clientY - rect.top - padding) / (canvasHeight - 2 * padding),
        ),
      );

      // Don't allow moving first or last point horizontally
      const newPoints = [...currentPoints];
      if (selectedPointIndex === 0) {
        newPoints[selectedPointIndex] = { x: 0, y };
      } else if (selectedPointIndex === currentPoints.length - 1) {
        newPoints[selectedPointIndex] = { x: 1, y };
      } else {
        // Constrain x to be between adjacent points
        const prevX = newPoints[selectedPointIndex - 1]?.x || 0;
        const nextX = newPoints[selectedPointIndex + 1]?.x || 1;
        const constrainedX = Math.max(prevX + 0.01, Math.min(nextX - 0.01, x));
        newPoints[selectedPointIndex] = { x: constrainedX, y };
      }

      onChange({
        ...values,
        [activeChannel]: newPoints,
      });
    },
    [selectedPointIndex, currentPoints, activeChannel, values, onChange],
  );

  // Handle mouse down on point
  const handlePointMouseDown = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedPointIndex(index);
      setIsDragging(true);
    },
    [],
  );

  // Handle mouse up
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
      setSelectedPointIndex(null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handlePointDrag(e);
      }
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handlePointDrag]);

  // Handle click on canvas to add point
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!svgRef.current || isDragging) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - padding) / (canvasWidth - 2 * padding);
      const y =
        1 - (e.clientY - rect.top - padding) / (canvasHeight - 2 * padding);

      // Don't add points outside valid range
      if (x < 0.01 || x > 0.99 || y < 0 || y > 1) return;

      // Add new point
      const newPoints = [...currentPoints, { x, y }].sort((a, b) => a.x - b.x);

      onChange({
        ...values,
        [activeChannel]: newPoints,
      });
    },
    [currentPoints, activeChannel, values, onChange, isDragging],
  );

  // Handle double-click on point to remove it
  const handlePointDoubleClick = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Don't remove first or last point
      if (index === 0 || index === currentPoints.length - 1) return;

      const newPoints = currentPoints.filter((_, i) => i !== index);

      onChange({
        ...values,
        [activeChannel]: newPoints,
      });
    },
    [currentPoints, activeChannel, values, onChange],
  );

  // Reset current channel
  const handleResetChannel = useCallback(() => {
    onChange({
      ...values,
      [activeChannel]: [...DEFAULT_CURVES[activeChannel]],
    });
  }, [activeChannel, values, onChange]);

  // Generate curve path
  const curvePath = useMemo(() => {
    return generateCurvePath(
      currentPoints,
      canvasWidth - 2 * padding,
      canvasHeight - 2 * padding,
    );
  }, [currentPoints]);

  // Generate diagonal reference line
  const diagonalPath = `M ${padding} ${canvasHeight - padding} L ${
    canvasWidth - padding
  } ${padding}`;

  return (
    <div className="space-y-3">
      {/* Channel Tabs */}
      <div className="flex gap-1 justify-center">
        <ChannelTab
          channel="rgb"
          label="RGB"
          isActive={activeChannel === "rgb"}
          onClick={() => setActiveChannel("rgb")}
        />
        <ChannelTab
          channel="red"
          label="R"
          isActive={activeChannel === "red"}
          onClick={() => setActiveChannel("red")}
        />
        <ChannelTab
          channel="green"
          label="G"
          isActive={activeChannel === "green"}
          onClick={() => setActiveChannel("green")}
        />
        <ChannelTab
          channel="blue"
          label="B"
          isActive={activeChannel === "blue"}
          onClick={() => setActiveChannel("blue")}
        />
      </div>

      {/* Curve Canvas */}
      <div className="relative bg-bg-2 rounded-lg overflow-hidden">
        <svg
          ref={svgRef}
          width={canvasWidth}
          height={canvasHeight}
          className="cursor-crosshair"
          onClick={handleCanvasClick}
        >
          {/* Grid lines */}
          <defs>
            <pattern
              id="grid"
              width={canvasWidth / 4}
              height={canvasHeight / 4}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${canvasWidth / 4} 0 L 0 0 0 ${canvasHeight / 4}`}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width={canvasWidth} height={canvasHeight} fill="url(#grid)" />

          {/* Diagonal reference line */}
          <path
            d={diagonalPath}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1"
            strokeDasharray="4,4"
          />

          {/* Curve */}
          <g transform={`translate(${padding}, ${padding})`}>
            <path
              d={curvePath}
              fill="none"
              stroke={CHANNEL_COLORS[activeChannel]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Control points */}
            {currentPoints.map((point, index) => {
              const x = point.x * (canvasWidth - 2 * padding);
              const y = (1 - point.y) * (canvasHeight - 2 * padding);
              const isSelected = selectedPointIndex === index;
              const isEndpoint =
                index === 0 || index === currentPoints.length - 1;

              return (
                <g key={index}>
                  {/* Point hit area (larger for easier clicking) */}
                  <circle
                    cx={x}
                    cy={y}
                    r={12}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseDown={handlePointMouseDown(index)}
                    onDoubleClick={handlePointDoubleClick(index)}
                  />
                  {/* Visible point */}
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 6 : 4}
                    fill={isEndpoint ? "#666" : CHANNEL_COLORS[activeChannel]}
                    stroke="white"
                    strokeWidth={isSelected ? 2 : 1}
                    className="pointer-events-none"
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Controls */}
      <div className="flex justify-between items-center">
        <Text type="supporting" color="secondary" className="text-[9px]">
          Click to add point • Double-click to remove
        </Text>
        <Button
          label="Reset"
          icon={<RotateCcw size={10} />}
          variant="ghost"
          size="sm"
          onClick={handleResetChannel}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-fg-3 hover:text-fg transition-colors"
        />
      </div>

      {/* Point count indicator */}
      <Text type="supporting" color="secondary" className="block text-center text-[9px]">
        {currentPoints.length} points
      </Text>
    </div>
  );
};

export default CurvesEditor;
