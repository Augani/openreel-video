import { describe, expect, it } from "vitest";
import type { TextClip } from "@openreel/core";
import { inPlaceEditorStyle, inPlaceKeyAction, normalizeEditedText, shouldCommitEdit } from "./text-inplace-edit";

describe("in-place text editing helpers", () => {
  it("maps keys: Enter commits, Shift+Enter breaks the line, Escape cancels", () => {
    expect(inPlaceKeyAction({ key: "Enter", shiftKey: false })).toBe("commit");
    expect(inPlaceKeyAction({ key: "Enter", shiftKey: true })).toBe("newline");
    expect(inPlaceKeyAction({ key: "Escape", shiftKey: false })).toBe("cancel");
    expect(inPlaceKeyAction({ key: "a", shiftKey: false })).toBeNull();
  });

  it("leaves Enter alone while an IME is composing", () => {
    expect(inPlaceKeyAction({ key: "Enter", shiftKey: false, isComposing: true })).toBeNull();
    expect(inPlaceKeyAction({ key: "Escape", shiftKey: false, isComposing: true })).toBeNull();
  });

  it("normalizes line breaks and trailing newlines", () => {
    expect(normalizeEditedText("a\r\nb\n\n")).toBe("a\nb");
    expect(normalizeEditedText("a b")).toBe("a b");
  });

  it("only commits real changes with visible text", () => {
    expect(shouldCommitEdit("Hello", "Hello")).toBe(false);
    expect(shouldCommitEdit("Hello", "   ")).toBe(false);
    expect(shouldCommitEdit("Hello", "Hello!")).toBe(true);
  });

  it("styles the editor like the canvas text, scaled to the monitor", () => {
    const clip = {
      style: { fontFamily: "Bebas", fontSize: 100, fontWeight: 700, fontStyle: "italic", color: "#abc", textAlign: "right", verticalAlign: "middle", lineHeight: 1.1, letterSpacing: 2, textDecoration: "underline" },
      transform: { position: { x: 0.5, y: 0.5 }, scale: { x: 2, y: 2 }, anchor: { x: 0.5, y: 0.5 }, rotation: 15, opacity: 1 },
    } as unknown as Pick<TextClip, "style" | "transform">;
    const css = inPlaceEditorStyle(clip, 0.5);
    expect(css.fontSize).toBe(100);
    expect(css.letterSpacing).toBe(2);
    expect(css.fontFamily).toContain("Bebas");
    expect(css.textAlign).toBe("right");
    expect(css.transform).toContain("rotate(15deg)");
    expect(css.textDecoration).toBe("underline");
  });
});
