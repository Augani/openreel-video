import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Keyframe, Clip } from "@openreel/core";
import { EASING_FUNCTIONS, type EasingName } from "@openreel/core";
import { X, Copy, Clipboard, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
  ScrollArea,
} from "@openreel/ui";

const PROPERTY_COLORS: Record<string, string> = {
  "position.x": "#22d3ee",
  "position.y": "#a78bfa",
  "scale.x": "#4ade80",
  "scale.y": "#86efac",
  rotation: "#f472b6",
  opacity: "#fbbf24",
  borderRadius: "#94a3b8",
  default: "#64748b",
};

const EASING_PRESETS: { label: string; value: EasingName }[] = [
  { label: "Linear", value: "linear" },
  { label: "Ease In", value: "easeInQuad" },
  { label: "Ease Out", value: "easeOutQuad" },
  { label: "Ease In Out", value: "easeInOutQuad" },
  { label: "Ease In Cubic", value: "easeInCubic" },
  { label: "Ease Out Cubic", value: "easeOutCubic" },
  { label: "Ease In Out Cubic", value: "easeInOutCubic" },
  { label: "Ease In Quart", value: "easeInQuart" },
  { label: "Ease Out Quart", value: "easeOutQuart" },
  { label: "Ease In Out Quart", value: "easeInOutQuart" },
  { label: "Ease In Back", value: "easeInBack" },
  { label: "Ease Out Back", value: "easeOutBack" },
  { label: "Ease In Out Back", value: "easeInOutBack" },
  { label: "Ease In Elastic", value: "easeInElastic" },
  { label: "Ease Out Elastic", value: "easeOutElastic" },
  { label: "Ease In Out Elastic", value: "easeInOutElastic" },
  { label: "Ease In Bounce", value: "easeInBounce" },
  { label: "Ease Out Bounce", value: "easeOutBounce" },
  { label: "Ease In Out Bounce", value: "easeInOutBounce" },
];

interface KeyframeEditorPanelProps {
  clip: Clip | null;
  onClose: () => void;
  onUpdateKeyframe: (keyframeId: string, updates: Partial<Keyframe>) => void;
  onDeleteKeyframe: (keyframeId: string) => void;
  onCopyKeyframes: (keyframeIds: string[]) => void;
  onPasteKeyframes: (clipId: string, time: number) => void;
  selectedKeyframeIds: string[];
  onSelectKeyframe: (keyframeId: string, addToSelection: boolean) => void;
  copiedKeyframes: Keyframe[];
}

interface PropertyGroup {
  property: string;
  keyframes: Keyframe[];
  color: string;
}

const GRAPH_PADDING = 40;
const GRAPH_HEIGHT = 200;

export const KeyframeEditorPanel: React.FC<KeyframeEditorPanelProps> = ({
  clip,
  onClose,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onCopyKeyframes,
  onPasteKeyframes,
  selectedKeyframeIds,
  onSelectKeyframe,
  copiedKeyframes,
}) => {
  const [activeProperty, setActiveProperty] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragKeyframeId, setDragKeyframeId] = useState<string | null>(null);
  const graphWidth = 600;

  const propertyGroups = useMemo((): PropertyGroup[] => {
    if (!clip?.keyframes) return [];

    const groups = new Map<string, Keyframe[]>();
    for (const kf of clip.keyframes) {
      const existing = groups.get(kf.property) || [];
      existing.push(kf);
      groups.set(kf.property, existing);
    }

    return Array.from(groups.entries())
      .map(([property, keyframes]) => ({
        property,
        keyframes: keyframes.sort((a, b) => a.time - b.time),
        color: PROPERTY_COLORS[property] || PROPERTY_COLORS.default,
      }))
      .sort((a, b) => a.property.localeCompare(b.property));
  }, [clip?.keyframes]);

  useEffect(() => {
    if (propertyGroups.length > 0 && !activeProperty) {
      setActiveProperty(propertyGroups[0].property);
    }
  }, [propertyGroups, activeProperty]);

  const activeGroup = useMemo(() => {
    return propertyGroups.find((g) => g.property === activeProperty) || null;
  }, [propertyGroups, activeProperty]);

  const timeRange = useMemo(() => {
    if (!activeGroup || activeGroup.keyframes.length === 0) {
      return { min: 0, max: clip?.duration || 1 };
    }
    const times = activeGroup.keyframes.map((kf) => kf.time);
    return {
      min: Math.min(0, ...times),
      max: Math.max(clip?.duration || 1, ...times),
    };
  }, [activeGroup, clip?.duration]);

  const valueRange = useMemo(() => {
    if (!activeGroup || activeGroup.keyframes.length === 0) {
      return { min: 0, max: 1 };
    }
    const values = activeGroup.keyframes.map((kf) => kf.value as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 0.1;
    return { min: min - padding, max: max + padding };
  }, [activeGroup]);

  const timeToX = useCallback(
    (time: number): number => {
      const range = timeRange.max - timeRange.min;
      return GRAPH_PADDING + ((time - timeRange.min) / range) * (graphWidth - GRAPH_PADDING * 2);
    },
    [timeRange, graphWidth]
  );

  const valueToY = useCallback(
    (value: number): number => {
      const range = valueRange.max - valueRange.min;
      return GRAPH_PADDING + (1 - (value - valueRange.min) / range) * (GRAPH_HEIGHT - GRAPH_PADDING * 2);
    },
    [valueRange]
  );

  const xToTime = useCallback(
    (x: number): number => {
      const range = timeRange.max - timeRange.min;
      return timeRange.min + ((x - GRAPH_PADDING) / (graphWidth - GRAPH_PADDING * 2)) * range;
    },
    [timeRange, graphWidth]
  );

  const yToValue = useCallback(
    (y: number): number => {
      const range = valueRange.max - valueRange.min;
      return valueRange.min + (1 - (y - GRAPH_PADDING) / (GRAPH_HEIGHT - GRAPH_PADDING * 2)) * range;
    },
    [valueRange]
  );

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeGroup) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = graphWidth * dpr;
    canvas.height = GRAPH_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, graphWidth, GRAPH_HEIGHT);

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = GRAPH_PADDING + (i / 10) * (graphWidth - GRAPH_PADDING * 2);
      ctx.beginPath();
      ctx.moveTo(x, GRAPH_PADDING);
      ctx.lineTo(x, GRAPH_HEIGHT - GRAPH_PADDING);
      ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const y = GRAPH_PADDING + (i / 5) * (GRAPH_HEIGHT - GRAPH_PADDING * 2);
      ctx.beginPath();
      ctx.moveTo(GRAPH_PADDING, y);
      ctx.lineTo(graphWidth - GRAPH_PADDING, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(GRAPH_PADDING, GRAPH_HEIGHT - GRAPH_PADDING);
    ctx.lineTo(graphWidth - GRAPH_PADDING, GRAPH_HEIGHT - GRAPH_PADDING);
    ctx.lineTo(graphWidth - GRAPH_PADDING, GRAPH_PADDING);
    ctx.stroke();

    ctx.fillStyle = "#888";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
      const time = timeRange.min + (i / 5) * (timeRange.max - timeRange.min);
      const x = timeToX(time);
      ctx.fillText(time.toFixed(2) + "s", x, GRAPH_HEIGHT - 10);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
      const value = valueRange.min + (i / 5) * (valueRange.max - valueRange.min);
      const y = valueToY(value);
      ctx.fillText(value.toFixed(2), GRAPH_PADDING - 5, y + 3);
    }

    if (activeGroup.keyframes.length > 1) {
      ctx.strokeStyle = activeGroup.color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      const samples = 100;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const startIdx = Math.floor(t * (activeGroup.keyframes.length - 1));
        const endIdx = Math.min(startIdx + 1, activeGroup.keyframes.length - 1);
        const localT = t * (activeGroup.keyframes.length - 1) - startIdx;

        const startKf = activeGroup.keyframes[startIdx];
        const endKf = activeGroup.keyframes[endIdx];

        const easingFn = EASING_FUNCTIONS[startKf.easing as EasingName] || EASING_FUNCTIONS.linear;
        const easedT = easingFn(localT);

        const time = startKf.time + (endKf.time - startKf.time) * localT;
        const value =
          (startKf.value as number) +
          ((endKf.value as number) - (startKf.value as number)) * easedT;

        const x = timeToX(time);
        const y = valueToY(value);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    for (const kf of activeGroup.keyframes) {
      const x = timeToX(kf.time);
      const y = valueToY(kf.value as number);
      const isSelected = selectedKeyframeIds.includes(kf.id);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);

      ctx.fillStyle = activeGroup.color;
      ctx.fillRect(-6, -6, 12, 12);

      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(-6, -6, 12, 12);

        ctx.shadowColor = activeGroup.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(-6, -6, 12, 12);
      }

      ctx.restore();
    }
  }, [activeGroup, graphWidth, timeToX, valueToY, timeRange, valueRange, selectedKeyframeIds]);

  useEffect(() => {
    drawGraph();
  }, [drawGraph]);

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!activeGroup) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      for (const kf of activeGroup.keyframes) {
        const kfX = timeToX(kf.time);
        const kfY = valueToY(kf.value as number);
        const dist = Math.sqrt((x - kfX) ** 2 + (y - kfY) ** 2);

        if (dist < 10) {
          onSelectKeyframe(kf.id, e.shiftKey || e.metaKey);
          setIsDragging(true);
          setDragKeyframeId(kf.id);
          return;
        }
      }
    },
    [activeGroup, timeToX, valueToY, onSelectKeyframe]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || !dragKeyframeId || !activeGroup) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const newTime = Math.max(0, xToTime(x));
      const newValue = yToValue(y);

      onUpdateKeyframe(dragKeyframeId, { time: newTime, value: newValue });
    },
    [isDragging, dragKeyframeId, activeGroup, xToTime, yToValue, onUpdateKeyframe]
  );

  const handleCanvasMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragKeyframeId(null);
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragKeyframeId(null);
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const handleCopy = useCallback(() => {
    onCopyKeyframes(selectedKeyframeIds);
  }, [onCopyKeyframes, selectedKeyframeIds]);

  const handlePaste = useCallback(() => {
    if (!clip) return;
    onPasteKeyframes(clip.id, 0);
  }, [clip, onPasteKeyframes]);

  const handleDelete = useCallback(() => {
    for (const id of selectedKeyframeIds) {
      onDeleteKeyframe(id);
    }
  }, [selectedKeyframeIds, onDeleteKeyframe]);

  const handleEasingChange = useCallback(
    (easing: string) => {
      for (const id of selectedKeyframeIds) {
        onUpdateKeyframe(id, { easing: easing as EasingName });
      }
    },
    [selectedKeyframeIds, onUpdateKeyframe]
  );

  if (!clip) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <p className="text-sm">Select a clip with keyframes to edit</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background-secondary border-l border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">Keyframe Editor</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-background-elevated text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background-tertiary">
        <Select value={activeProperty || ""} onValueChange={setActiveProperty}>
          <SelectTrigger className="w-[180px] h-8">
            <SelectValue placeholder="Select property" />
          </SelectTrigger>
          <SelectContent>
            {propertyGroups.map((group) => (
              <SelectItem key={group.property} value={group.property}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span>{group.property}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={selectedKeyframeIds.length === 0}
          className="h-8 px-2"
        >
          <Copy size={14} className="mr-1" />
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePaste}
          disabled={copiedKeyframes.length === 0}
          className="h-8 px-2"
        >
          <Clipboard size={14} className="mr-1" />
          Paste
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={selectedKeyframeIds.length === 0}
          className="h-8 px-2 text-red-400 hover:text-red-300"
        >
          <Trash2 size={14} className="mr-1" />
          Delete
        </Button>
      </div>

      <div className="flex-1 p-4 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={graphWidth}
          height={GRAPH_HEIGHT}
          className="rounded border border-border cursor-crosshair"
          style={{ width: graphWidth, height: GRAPH_HEIGHT }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
        />
      </div>

      <div className="px-4 py-3 border-t border-border bg-background-tertiary">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Easing:</span>
            <Select
              value={selectedKeyframeIds.length > 0 ? undefined : ""}
              onValueChange={handleEasingChange}
              disabled={selectedKeyframeIds.length === 0}
            >
              <SelectTrigger className="w-[160px] h-7 text-xs">
                <SelectValue placeholder="Select easing" />
              </SelectTrigger>
              <SelectContent>
                {EASING_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1" />

          <span className="text-xs text-text-muted">
            {selectedKeyframeIds.length} keyframe{selectedKeyframeIds.length !== 1 ? "s" : ""} selected
          </span>
        </div>
      </div>

      {activeGroup && (
        <ScrollArea className="max-h-32 border-t border-border">
          <div className="p-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted">
                  <th className="text-left py-1 px-2">Time</th>
                  <th className="text-left py-1 px-2">Value</th>
                  <th className="text-left py-1 px-2">Easing</th>
                </tr>
              </thead>
              <tbody>
                {activeGroup.keyframes.map((kf) => (
                  <tr
                    key={kf.id}
                    className={`cursor-pointer hover:bg-background-elevated transition-colors ${
                      selectedKeyframeIds.includes(kf.id) ? "bg-primary/20" : ""
                    }`}
                    onClick={(e) => onSelectKeyframe(kf.id, e.shiftKey || e.metaKey)}
                  >
                    <td className="py-1 px-2">{kf.time.toFixed(3)}s</td>
                    <td className="py-1 px-2">{(kf.value as number).toFixed(3)}</td>
                    <td className="py-1 px-2">{kf.easing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

export default KeyframeEditorPanel;
