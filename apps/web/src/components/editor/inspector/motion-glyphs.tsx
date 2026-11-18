import React from "react";

/** Small diagrams that show what a mode does; all drawn from currentColor so they follow the theme. */

const FRAME = (
  <rect x="1" y="1" width="46" height="30" rx="3" fill="none" stroke="currentColor" strokeOpacity={0.35} />
);

export type ScrollGlyphMode = "none" | "roll" | "crawl";

export const ScrollModeGlyph: React.FC<{
  mode: ScrollGlyphMode;
  direction?: "up" | "down" | "left" | "right";
  className?: string;
}> = ({ mode, direction, className }) => {
  const dir = direction ?? (mode === "roll" ? "up" : "left");
  return (
    <svg viewBox="0 0 48 32" className={className} aria-hidden data-glyph={`scroll-${mode}`} data-direction={mode === "none" ? undefined : dir}>
      {FRAME}
      {mode === "none" && (
        <g stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <line x1="12" y1="12" x2="36" y2="12" />
          <line x1="16" y1="18" x2="32" y2="18" />
          <line x1="20" y1="24" x2="28" y2="24" strokeOpacity={0.6} />
        </g>
      )}
      {mode === "roll" && (
        <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="10" y1="9" x2="26" y2="9" strokeOpacity={0.9} />
          <line x1="10" y1="15" x2="30" y2="15" strokeOpacity={0.6} />
          <line x1="10" y1="21" x2="24" y2="21" strokeOpacity={0.35} />
          {dir === "down" ? (
            <path d="M39 8v16m-4-4 4 4 4-4" />
          ) : (
            <path d="M39 24V8m-4 4 4-4 4 4" />
          )}
        </g>
      )}
      {mode === "crawl" && (
        <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="8" y1="14" x2="40" y2="14" strokeDasharray="8 3" />
          {dir === "right" ? (
            <path d="M8 24h32m-4-4 4 4-4 4" />
          ) : (
            <path d="M40 24H8m4-4-4 4 4 4" />
          )}
        </g>
      )}
    </svg>
  );
};

export type PathGlyphType = "linear" | "bezier" | "catmull-rom";

export const PathTypeGlyph: React.FC<{ type: PathGlyphType; className?: string }> = ({ type, className }) => (
  <svg viewBox="0 0 48 32" className={className} aria-hidden data-glyph={`path-${type}`}>
    {FRAME}
    {type === "linear" && (
      <polyline points="6,24 20,10 30,22 42,8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    )}
    {type === "bezier" && (
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M6 24C16 24 16 8 26 8S38 24 42 10" strokeWidth={2} />
        <path d="M6 24l10 0M26 8l-10 0" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="2 2" />
      </g>
    )}
    {type === "catmull-rom" && (
      <path d="M6 22C12 8 18 8 24 16S36 26 42 8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    )}
    <g fill="currentColor">
      <circle cx="6" cy={type === "bezier" || type === "linear" ? 24 : 22} r="2" />
      <circle cx="42" cy={type === "linear" ? 8 : type === "bezier" ? 10 : 8} r="2" />
    </g>
  </svg>
);
