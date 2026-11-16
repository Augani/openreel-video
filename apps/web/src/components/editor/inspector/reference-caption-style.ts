import type { TextStyle } from "@openreel/core";

/** The four authored caption samples, scaled to the output canvas rather than the device viewport. */
export function getReferenceCaptionStyle(preset: string, frameHeight: number): Partial<TextStyle> | undefined {
  const fontSize = Math.max(12, frameHeight * 96 / 1080);
  const base = { fontFamily: "Inter", fontSize, color: "#ffffff", backgroundColor: "transparent" };
  switch (preset) {
    case "default": return { ...base, fontWeight: 600, backgroundColor: "rgba(0, 0, 0, 0.75)" };
    case "pop-words": return { ...base, fontWeight: 800, color: "#111111", backgroundColor: "#f5d547" };
    case "bold": return { ...base, fontWeight: 900, strokeColor: "#000000", strokeWidth: fontSize / 9 };
    case "minimal": return { ...base, fontWeight: 500 };
    default: return undefined;
  }
}
