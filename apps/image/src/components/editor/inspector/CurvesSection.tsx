import { useState, useRef, useCallback } from "react";
import { useProjectStore } from "../../../stores/project-store";
import type { Layer } from "../../../types/project";
import type { CurvePoint } from "../../../types/adjustments";
import { DEFAULT_CURVES } from "../../../types/adjustments";
import { TrendingUp, RotateCcw } from "lucide-react";

interface Props {
  layer: Layer;
}

type ChannelType = "master" | "red" | "green" | "blue";

interface CurveEditorProps {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  channel: ChannelType;
}

function CurveEditor({ points, onChange, channel }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const channelColors: Record<ChannelType, string> = {
    master: "hsl(var(--foreground))",
    red: "#ef4444",
    green: "#22c55e",
    blue: "#3b82f6",
  };

  const sortedPoints = [...points].sort((a, b) => a.input - b.input);

  const getPathD = useCallback(() => {
    if (sortedPoints.length < 2) return "";

    const pathPoints = sortedPoints.map((p) => ({
      x: (p.input / 255) * 100,
      y: 100 - (p.output / 255) * 100,
    }));

    let d = `M ${pathPoints[0].x} ${pathPoints[0].y}`;

    for (let i = 1; i < pathPoints.length; i++) {
      const prev = pathPoints[i - 1];
      const curr = pathPoints[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    return d;
  }, [sortedPoints]);

  const handleMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (index === 0 || index === sortedPoints.length - 1) return;
    setDraggingIndex(index);
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (draggingIndex === null || !svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 255;
      const y = (1 - (e.clientY - rect.top) / rect.height) * 255;

      const newPoints = [...sortedPoints];
      newPoints[draggingIndex] = {
        input: Math.max(1, Math.min(254, Math.round(x))),
        output: Math.max(0, Math.min(255, Math.round(y))),
      };
      onChange(newPoints);
    },
    [draggingIndex, sortedPoints, onChange],
  );

  const handleMouseUp = () => {
    setDraggingIndex(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (draggingIndex !== null || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 255;
    const y = (1 - (e.clientY - rect.top) / rect.height) * 255;

    if (sortedPoints.length >= 14) return;

    const newPoint: CurvePoint = {
      input: Math.round(x),
      output: Math.round(y),
    };
    onChange([...sortedPoints, newPoint]);
  };

  const handleDoubleClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0 || index === sortedPoints.length - 1) return;
    const newPoints = sortedPoints.filter((_, i) => i !== index);
    onChange(newPoints);
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="w-full h-32 bg-secondary/50 rounded border border-border cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      >
        <defs>
          <pattern
            id="grid"
            width="25"
            height="25"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 25 0 L 0 0 0 25"
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              opacity="0.5"
            />
          </pattern>
        </defs>

        <rect width="100" height="100" fill="url(#grid)" />

        <line
          x1="0"
          y1="100"
          x2="100"
          y2="0"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.3"
        />

        <path
          d={getPathD()}
          fill="none"
          stroke={channelColors[channel]}
          strokeWidth="2"
        />

        {sortedPoints.map((point, index) => {
          const x = (point.input / 255) * 100;
          const y = 100 - (point.output / 255) * 100;
          const isEndpoint = index === 0 || index === sortedPoints.length - 1;
          const isHovered = hoverIndex === index;
          const isDragging = draggingIndex === index;

          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={isDragging || isHovered ? 4 : 3}
              fill={
                isEndpoint
                  ? "hsl(var(--muted-foreground))"
                  : channelColors[channel]
              }
              stroke="hsl(var(--background))"
              strokeWidth="1"
              className={isEndpoint ? "cursor-not-allowed" : "cursor-move"}
              onMouseDown={(e) => handleMouseDown(index, e)}
              onDoubleClick={(e) => handleDoubleClick(index, e)}
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          );
        })}
      </svg>
      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
        <span>0</span>
        <span>Input</span>
        <span>255</span>
      </div>
    </div>
  );
}

export function CurvesSection({ layer }: Props) {
  const { updateLayer } = useProjectStore();
  const [activeChannel, setActiveChannel] = useState<ChannelType>("master");
  const [isExpanded, setIsExpanded] = useState(true);

  const curves = layer.curves;

  const handlePointsChange = (points: CurvePoint[]) => {
    updateLayer(layer.id, {
      curves: {
        ...curves,
        [activeChannel]: { points },
      },
    });
  };

  const handleEnabledChange = (enabled: boolean) => {
    updateLayer(layer.id, {
      curves: {
        ...curves,
        enabled,
      },
    });
  };

  const resetCurves = () => {
    updateLayer(layer.id, {
      curves: { ...DEFAULT_CURVES },
    });
  };

  const channelColors: Record<ChannelType, string> = {
    master: "bg-foreground",
    red: "bg-red-500",
    green: "bg-pink-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium">Curves</span>
          {curves.enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={curves.enabled}
            onChange={(e) => {
              e.stopPropagation();
              handleEnabledChange(e.target.checked);
            }}
            className="w-3.5 h-3.5 rounded border-border"
          />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(["master", "red", "green", "blue"] as ChannelType[]).map(
                (channel) => (
                  <button
                    key={channel}
                    onClick={() => setActiveChannel(channel)}
                    className={`px-2 py-1 text-[10px] rounded transition-colors ${
                      activeChannel === channel
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${channelColors[channel]}`}
                    />
                    {channel.charAt(0).toUpperCase()}
                  </button>
                ),
              )}
            </div>
            <button
              onClick={resetCurves}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              title="Reset Curves"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <CurveEditor
            points={curves[activeChannel].points}
            onChange={handlePointsChange}
            channel={activeChannel}
          />

          <p className="text-[9px] text-muted-foreground text-center">
            Click to add point • Double-click to remove • Drag to adjust
          </p>
        </div>
      )}
    </div>
  );
}
