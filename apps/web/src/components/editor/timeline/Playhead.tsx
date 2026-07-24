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
      {/* pentagon handle at the top */}
      <div
        className="absolute"
        style={{
          top: 0,
          left: -7,
          width: 15,
          height: 13,
          background: "#1d1d1f",
          borderRadius: "3px 3px 0 0",
          clipPath: "polygon(0 0,100% 0,100% 65%,50% 100%,0 65%)",
        }}
      />
      {/* vertical line */}
      <div
        className="absolute"
        style={{
          top: 0,
          bottom: 0,
          left: 0,
          width: "1px",
          background: "#1d1d1f",
        }}
      />
    </div>
  );
};
