import React from "react";

interface PlayheadProps {
  position: number;
  pixelsPerSecond: number;
  scrollX: number;
  headerOffset: number;
}

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
        willChange: 'transform',
      }}
    >
      <div className="absolute -translate-x-1/2" style={{ top: '-1px' }}>
        <svg
          width="13"
          height="14"
          viewBox="0 0 13 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_0_8px_rgba(236,72,153,0.8)]"
        >
          <path d="M0.5 0H12.5V8L6.5 14L0.5 8V0Z" fill="#ec4899" />
        </svg>
      </div>
      <div
        className="absolute w-px bg-primary shadow-[0_0_10px_#ec4899]"
        style={{ top: '13px', bottom: 0, left: 0 }}
      />
    </div>
  );
};
