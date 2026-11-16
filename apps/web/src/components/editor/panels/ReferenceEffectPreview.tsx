import type { CSSProperties } from "react";

// Decorative artwork from the authored component HTML. Hover keeps the live
// media preview; applying a card uses the actual effect renderer.
const treatments: Record<string, [CSSProperties, CSSProperties, CSSProperties]> = {
  blur: [{}, { filter: "blur(5px)" }, { filter: "blur(4px)" }],
  sharpen: [{}, { boxShadow: "0 0 0 2px #FFF1D6" }, {}],
  vignette: [{ boxShadow: "inset 0 0 18px 10px rgba(0,0,0,0.85)" }, {}, {}],
  grain: [{ background: "#4A3B30" }, { opacity: 0.85 }, { background: "repeating-linear-gradient(90deg,#241B16 0 2px,#3A2E26 2px 3px)" }],
  grayscale: [{ background: "#3A3A3A" }, { background: "#B8B8B8" }, { background: "#1E1E1E" }],
  lut: [{ background: "#5A3A1E" }, { background: "#F2B866" }, { background: "#3A2414" }],
  chromaKey: [{ background: "#1F8A4C" }, { background: "#E8E9EC", borderRadius: "50% 50% 0 0", top: "30%", height: "70%" }, { display: "none" }],
  glow: [{}, { boxShadow: "0 0 14px 6px rgba(255,214,150,0.75)" }, {}],
  pixelate: [{}, { borderRadius: 0, background: "repeating-linear-gradient(0deg,#D3AE78 0 6px,#B8925E 6px 12px)" }, {}],
  mirror: [{}, { left: "6%", width: "38%", borderRadius: "50% 0 0 50%" }, { borderTop: "2px solid #D3AE78" }],
  "lens-distort": [{}, { borderRadius: "40%", transform: "scale(1.25)" }, { borderRadius: "50% 50% 0 0" }],
  stabilize: [{ background: "#323A46" }, { background: "none", border: "2px dashed #C4C6CC", borderRadius: 4 }, { background: "#20252D" }],
};

// The pro implementations replaced the legacy cards of the same concept in the
// browser; they keep the legacy card artwork.
treatments["pro-gaussian-blur"] = treatments.blur;
treatments["pro-mosaic"] = treatments.pixelate;
treatments["pro-mirror"] = treatments.mirror;
treatments["pro-lens-distortion"] = treatments["lens-distort"];

export function hasReferenceEffectPreview(id: string) {
  return Object.hasOwn(treatments, id);
}

export function ReferenceEffectPreview({ id }: { id: string }) {
  const treatment = treatments[id];
  if (!treatment) return null;
  return <div aria-hidden="true" className="absolute inset-0" style={{ background: "#3A2E26", ...treatment[0] }}>
    <div style={{ position: "absolute", left: "24%", top: "22%", width: "44%", height: "44%", borderRadius: "50%", background: "#D3AE78", ...treatment[1] }} />
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "30%", background: "#241B16", ...treatment[2] }} />
  </div>;
}
