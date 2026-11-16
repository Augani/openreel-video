import type { BrowserWindow } from "electron";

/**
 * The one window that hosts the editor (and therefore the MCP renderer listener).
 * Linked-composition and other auxiliary windows are never registered here, so
 * the MCP bridge cannot route tool calls to them.
 */
let editorWindow: BrowserWindow | null = null;
let factory: (() => BrowserWindow) | null = null;

export function registerEditorWindow(win: BrowserWindow): void {
  editorWindow = win;
  win.once("closed", () => {
    if (editorWindow === win) editorWindow = null;
  });
}

export function getEditorWindow(): BrowserWindow | null {
  return editorWindow && !editorWindow.isDestroyed() ? editorWindow : null;
}

/** index.ts installs how to create an editor window; the bridge calls it when none exists. */
export function setEditorWindowFactory(create: (() => BrowserWindow) | null): void {
  factory = create;
}

/**
 * Returns the editor window, creating a hidden one on demand (macOS keeps the
 * app alive with zero windows). Returns null only if no factory is installed.
 */
export function ensureEditorWindow(): BrowserWindow | null {
  const existing = getEditorWindow();
  if (existing) return existing;
  if (!factory) return null;
  const created = factory();
  if (getEditorWindow() !== created) registerEditorWindow(created);
  return created;
}

/** Test hook: forgets the tracked window and the factory. */
export function resetEditorWindowForTests(): void {
  editorWindow = null;
  factory = null;
}
