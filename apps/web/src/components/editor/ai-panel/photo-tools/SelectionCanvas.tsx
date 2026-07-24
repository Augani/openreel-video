import type { JSX } from "react";
import { useRef, useState } from "react";
import type { BBox, MaskTool, NormPoint } from "./object-removal-params";

interface SelectionCanvasProps {
  imageUrl: string;
  tool: MaskTool;
  bbox: BBox | null;
  points: NormPoint[];
  onBBoxChange: (bbox: BBox | null) => void;
  onPointsChange: (points: NormPoint[]) => void;
}

interface NormXY {
  x: number;
  y: number;
}

export function SelectionCanvas({
  imageUrl,
  tool,
  bbox,
  points,
  onBBoxChange,
  onPointsChange,
}: SelectionCanvasProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<NormXY | null>(null);
  const [dragNow, setDragNow] = useState<NormXY | null>(null);

  const normalize = (clientX: number, clientY: number): NormXY => {
    const el = ref.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (tool !== "box") return;
    const p = normalize(e.clientX, e.clientY);
    setDragStart(p);
    setDragNow(p);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (tool !== "box" || !dragStart) return;
    setDragNow(normalize(e.clientX, e.clientY));
  };

  const finishDrag = (): void => {
    if (tool === "box" && dragStart && dragNow) {
      const x = Math.min(dragStart.x, dragNow.x);
      const y = Math.min(dragStart.y, dragNow.y);
      const w = Math.abs(dragNow.x - dragStart.x);
      const h = Math.abs(dragNow.y - dragStart.y);
      if (w > 0.01 && h > 0.01) onBBoxChange({ x, y, w, h });
    }
    setDragStart(null);
    setDragNow(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (tool !== "points") return;
    onPointsChange([...points, normalize(e.clientX, e.clientY)]);
  };

  const liveBox: BBox | null =
    dragStart && dragNow
      ? {
          x: Math.min(dragStart.x, dragNow.x),
          y: Math.min(dragStart.y, dragNow.y),
          w: Math.abs(dragNow.x - dragStart.x),
          h: Math.abs(dragNow.y - dragStart.y),
        }
      : bbox;

  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        className="relative inline-block select-none"
        style={{ cursor: tool === "box" ? "crosshair" : "copy" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finishDrag}
        onMouseLeave={finishDrag}
        onClick={handleClick}
      >
        <img
          src={imageUrl}
          alt="Selected photo"
          draggable={false}
          className="block max-h-[58vh] max-w-full rounded"
        />
        {tool === "box" && liveBox && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/15"
            style={{
              left: `${liveBox.x * 100}%`,
              top: `${liveBox.y * 100}%`,
              width: `${liveBox.w * 100}%`,
              height: `${liveBox.h * 100}%`,
            }}
          />
        )}
        {tool === "points" &&
          points.map((p, i) => (
            <div
              key={`${p.x.toFixed(4)}-${p.y.toFixed(4)}-${i}`}
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            />
          ))}
      </div>
    </div>
  );
}
