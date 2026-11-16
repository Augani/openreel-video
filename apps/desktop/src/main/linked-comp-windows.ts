import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { CHANNELS, linkedCompOpenArgsSchema } from "../shared/ipc-contract";
import { APP_INDEX } from "./protocol";
import { installNavigationGuard } from "./nav-guard";
import { LinkedCompHub, type HubPeer } from "./linked-comp-hub";

/**
 * Linked composition windows. The editor window (which owns the project) opens one
 * window per composition; the windows talk to the editor only through the hub, so an
 * edit made in a composition window reaches the editor's stores over IPC and the
 * timeline there updates immediately.
 */

const hub = new LinkedCompHub();
const windows = new Map<string, BrowserWindow>();

const peerOf = (contents: WebContents): HubPeer => ({
  id: contents.id,
  isDestroyed: () => contents.isDestroyed(),
  send: (channel, payload) => {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  },
});

function createCompositionWindow(compositionId: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    title: "Linked composition",
    backgroundColor: "#1b1b20",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  installNavigationGuard(win, APP_INDEX);
  void win.loadURL(`${APP_INDEX}#/composition/${encodeURIComponent(compositionId)}`);
  return win;
}

/** Open the window for a composition, or focus it when it is already open. */
export function openCompositionWindow(opener: WebContents, compositionId: string): { ok: boolean; message?: string } {
  if (hub.isEditor(opener.id)) return { ok: false, message: "Open compositions from the editor window." };
  const existing = windows.get(compositionId);
  if (existing && !existing.isDestroyed()) {
    // Only reuse a window that edits for THIS editor window. A second project window holding a
    // copy of the same composition id must get its own window, or its timeline would never update.
    if (hub.editorOf(compositionId) && hub.hostOf(compositionId)?.id === opener.id) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true };
    }
    // Unregister first: the old window's "closed" handler must not tell the new host to forget it.
    hub.unregister(existing.webContents.id);
    windows.delete(compositionId);
    existing.close();
  }
  const win = createCompositionWindow(compositionId);
  windows.set(compositionId, win);
  const editor = peerOf(win.webContents);
  const host = peerOf(opener);
  hub.register(compositionId, host, editor);

  const editorId = win.webContents.id;
  win.once("closed", () => {
    const current = windows.get(compositionId);
    if (current === win) windows.delete(compositionId);
    hub.unregister(editorId);
    // A newer window for the same editor replaced this one: it is still watching.
    const replaced = current !== undefined && current !== win && hub.hostOf(compositionId)?.id === opener.id;
    // Tell the editor window nothing is watching any more (its host forgets the composition).
    if (!replaced && !opener.isDestroyed()) opener.send(CHANNELS.linkedCompMessage, { type: "closed", compositionId });
  });
  // The project closes with its editor window: so do its composition windows.
  opener.once("destroyed", () => {
    for (const orphan of hub.unregister(opener.id)) {
      const owner = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.webContents.id === orphan.id);
      owner?.close();
    }
  });
  return { ok: true };
}

/** Register the IPC handlers. Call once from `app.whenReady`. */
export function registerLinkedCompIpc(): void {
  ipcMain.handle(CHANNELS.linkedCompOpen, (event: IpcMainInvokeEvent, raw: unknown) => {
    const parsed = linkedCompOpenArgsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: "That is not a composition." };
    return openCompositionWindow(event.sender, parsed.data.compositionId);
  });
  ipcMain.on(CHANNELS.linkedCompPost, (event: IpcMainEvent, raw: unknown) => {
    hub.relay(event.sender.id, raw);
  });
}
