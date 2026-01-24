import React, { useCallback, useState, useEffect, useRef } from "react";
import type { Keyframe } from "@openreel/core";

interface KeyframeMarkerProps {
  keyframe: Keyframe;
  xPosition: number;
  color: string;
  isSelected: boolean;
  onSelect: (addToSelection: boolean) => void;
  onMove: (deltaPixels: number) => void;
  onDelete: () => void;
}

export const KeyframeMarker: React.FC<KeyframeMarkerProps> = ({
  keyframe,
  xPosition,
  color,
  isSelected,
  onSelect,
  onMove,
  onDelete,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const markerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey;
      onSelect(addToSelection);

      setIsDragging(true);
      setDragStartX(e.clientX);
    },
    [onSelect]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStartX;
      if (Math.abs(deltaX) > 2) {
        onMove(deltaX);
        setDragStartX(e.clientX);
      }
    },
    [isDragging, dragStartX, onMove]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onDelete();
    },
    [onDelete]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  return (
    <div
      ref={markerRef}
      className={`absolute top-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-110 ${
        isDragging ? "scale-125 z-50" : ""
      }`}
      style={{
        left: xPosition,
        transform: `translate(-50%, -50%) rotate(45deg) ${isDragging ? "scale(1.25)" : ""}`,
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className={`w-2.5 h-2.5 rounded-sm transition-all ${
          isSelected ? "ring-2 ring-white ring-offset-1 ring-offset-background-secondary" : ""
        }`}
        style={{
          backgroundColor: color,
          boxShadow: isSelected ? `0 0 8px ${color}` : "none",
        }}
      />

      {isSelected && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 rotate-[-45deg] whitespace-nowrap">
          <span className="text-[8px] text-text-muted bg-background-secondary/80 px-1 rounded">
            {keyframe.time.toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  );
};

export default KeyframeMarker;
