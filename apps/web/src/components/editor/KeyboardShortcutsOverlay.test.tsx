import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyboardShortcuts } from "../../services/keyboard-shortcuts";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";

beforeEach(() => { keyboardShortcuts.resetAllShortcuts(); });
afterEach(() => { cleanup(); keyboardShortcuts.resetAllShortcuts(); vi.restoreAllMocks(); });

function open() {
  const onClose = vi.fn();
  render(<KeyboardShortcutsOverlay isOpen onClose={onClose} />);
  return onClose;
}

function customizePlay() {
  fireEvent.click(screen.queryByRole("button", { name: "Customize Play/Pause shortcut" }) ?? screen.getByRole("button", { name: "Space" }));
  return screen.getByRole("textbox", { name: "Set shortcut for Play/Pause" });
}

describe("keyboard shortcut dialog interactions", () => {
  it("keeps conflict capture open, saves a custom key, and retains individual and full reset", () => {
    open();
    const input = customizePlay();
    fireEvent.keyDown(input, { key: "s" });
    expect(screen.getByRole("status")).toHaveTextContent("This shortcut is used by Split");
    expect(input).toBeInTheDocument();
    expect(keyboardShortcuts.getShortcut("playback.playPause")!.currentKey).toBe("space");
    fireEvent.keyDown(input, { key: "p", altKey: true, shiftKey: true });
    expect(keyboardShortcuts.getShortcut("playback.playPause")!.currentKey).toBe("shift+alt+p");
    fireEvent.click(screen.getByRole("button", { name: /Reset (?:Play\/Pause shortcut )?to default/ }));
    expect(keyboardShortcuts.getShortcut("playback.playPause")!.currentKey).toBe("space");
    fireEvent.keyDown(customizePlay(), { key: "p", altKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset All" }));
    expect(keyboardShortcuts.getAllShortcuts().every(shortcut => shortcut.currentKey === shortcut.defaultKey)).toBe(true);
    expect(keyboardShortcuts.getActivePreset()).toBe("openreel");
  });

});
