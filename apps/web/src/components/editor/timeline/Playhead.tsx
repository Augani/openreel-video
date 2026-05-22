import React from "react";

interface PlayheadProps {
  position: number;
  pixelsPerSecond: number;
  scrollX: number;
  headerOffset: number;
}

// Mockup playhead: thin accent vertical line with a downward triangle at the
// top. Color comes from --accent so it tracks the active theme.
export const Playhead: React.FC<PlayheadProps> = ({
  position,
  pixelsPerSecond,
  scrollX,
  headerOffset,
}) => {
  const pixelPosition = position * pixelsPerSecond - scrollX;

  if (pixelPosition < 0) return null;

  return (
    <div
      className="absolute top-0 bottom-0 z-50 pointer-events-none"
      style={{
        left: headerOffset,
        transform: `translateX(${pixelPosition}px)`,
        willChange: "transform",
      }}
    >
      {/* triangle marker at the top — accent-colored */}
      <div
        className="absolute -translate-x-1/2"
        style={{
          top: -1,
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "9px solid var(--accent)",
        }}
      />
      {/* vertical line below the triangle */}
      <div
        className="absolute"
        style={{
          top: 8,
          bottom: 0,
          left: 0,
          width: "1.5px",
          background: "var(--accent)",
        }}
      />
    </div>
  );
};
