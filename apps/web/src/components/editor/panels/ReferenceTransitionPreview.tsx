import type { CSSProperties } from "react";

// These are the original artwork declarations from Panel · Transitions in
// new-screens/OpenReel Pro Editor components.html (d7557d96…). Reuse the
// authored artwork, rather than rescaling the PNG's baked borders and badges.
const amber = "#C98A3E";
const treatments: Record<string, CSSProperties> = {
  crossfade: { inset: 0, background: amber, opacity: 0.5 },
  dipToBlack: { inset: 0, background: "#000", opacity: 0.7 },
  dipToWhite: { inset: 0, background: "#fff", opacity: 0.6 },
  "wipe-left": { top: 0, bottom: 0, right: 0, width: "50%", background: amber },
  "wipe-diagonal": { inset: 0, background: amber, clipPath: "polygon(60% 0,100% 0,100% 100%,20% 100%)" },
  circleReveal: { left: "50%", top: "50%", width: "56%", aspectRatio: "1 / 1", transform: "translate(-50%,-50%)", borderRadius: "50%", background: amber },
  slide: { top: 0, bottom: 0, left: "35%", right: "-35%", background: amber, boxShadow: "-4px 0 0 rgba(0,0,0,0.35)" },
  push: { top: 0, bottom: 0, left: "50%", width: "50%", background: amber, borderLeft: "2px solid #111" },
  zoom: { left: "20%", right: "20%", top: "20%", bottom: "20%", background: amber, borderRadius: 2 },
  blur: { inset: 0, background: amber, opacity: 0.55, filter: "blur(3px)" },
  whipPan: { inset: 0, background: `repeating-linear-gradient(90deg,${amber} 0 4px,#2C5287 4px 9px)` },
  glitch: { left: 0, right: 0, top: "30%", height: "22%", background: amber, boxShadow: "6px 12px 0 #F05252,-5px -9px 0 #5B8DEF" },
};

export function hasReferenceTransitionPreview(id: string) {
  return Object.hasOwn(treatments, id);
}

export function ReferenceTransitionPreview({ id }: { id: string }) {
  const treatment = treatments[id];
  return treatment ? <div aria-hidden="true" style={{ position: "absolute", boxSizing: "content-box", borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, color: "#E8E9EC", ...treatment }} /> : null;
}
