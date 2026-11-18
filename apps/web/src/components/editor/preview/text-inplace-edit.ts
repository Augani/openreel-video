import type { CSSProperties } from "react";
import type { TextClip } from "@openreel/core";

/**
 * Pure helpers for editing a text clip in place on the Program monitor.
 * The overlay editor (`TextInPlaceEditor`) is a contenteditable styled to
 * match what the canvas draws, so what you type is what you see.
 */

export type InPlaceKeyAction = "commit" | "cancel" | "newline" | null;

/** Enter commits, Shift+Enter inserts a line break, Escape cancels. IME composition is left alone. */
export function inPlaceKeyAction(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
}): InPlaceKeyAction {
  if (event.isComposing) return null;
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter") return event.shiftKey ? "newline" : "commit";
  return null;
}

/** Text as stored on the clip: LF line breaks, no trailing break the browser appends. */
export function normalizeEditedText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\n+$/g, "");
}

/** Empty text is not committed (it would leave an invisible clip); unchanged text is not an edit. */
export function shouldCommitEdit(original: string, edited: string): boolean {
  return edited.trim().length > 0 && edited !== original;
}

/** CSS that makes the editor render the clip's font the way the canvas does. */
export function inPlaceEditorStyle(
  clip: Pick<TextClip, "style" | "transform">,
  displayScale: number,
): CSSProperties {
  const { style, transform } = clip;
  const scale = displayScale * Math.abs(transform.scale.y || 1);
  return {
    fontFamily: `"${style.fontFamily}", sans-serif`,
    fontSize: style.fontSize * scale,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textAlign: style.textAlign === "justify" ? "justify" : style.textAlign,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing * scale,
    textDecoration: style.textDecoration && style.textDecoration !== "none" ? style.textDecoration : undefined,
    whiteSpace: "pre-wrap",
    transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
    opacity: Math.max(0.25, transform.opacity),
  };
}
