import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainEvent } from "electron";
import { CHANNELS } from "../shared/ipc-contract";

// Windows that have passed the guard and may close freely.
const forceClose = new WeakSet<BrowserWindow>();
// Windows whose guard is currently running, to ignore duplicate close events.
const handling = new WeakSet<BrowserWindow>();
// True once a full app quit has been requested (Cmd+Q / app.quit), so the guard
// knows to re-trigger the quit after a confirmed close rather than just hiding
// the window.
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

// Sentinel returned when the renderer does not reply within the timeout, so
// callers can distinguish "no answer" from a genuine reply and fail safe — a
// non-answer must never be read as "clean" or "saved".
const NO_REPLY = Symbol("no-reply");

function requestFromRenderer(
  win: BrowserWindow,
  sendChannel: string,
  replyChannel: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener(replyChannel, onReply);
      resolve(value);
    };
    const onReply = (event: IpcMainEvent, payload: unknown): void => {
      if (event.sender === win.webContents) finish(payload);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    ipcMain.on(replyChannel, onReply);
    if (win.isDestroyed()) {
      finish(NO_REPLY);
      return;
    }
    win.webContents.send(sendChannel);
  });
}

function finalizeClose(win: BrowserWindow): void {
  forceClose.add(win);
  if (quitting) {
    app.quit();
  } else if (!win.isDestroyed()) {
    win.close();
  }
}

async function handleGuardedClose(win: BrowserWindow): Promise<void> {
  const dirtyReply = await requestFromRenderer(
    win,
    CHANNELS.lifecycleUnsavedQuery,
    CHANNELS.lifecycleUnsavedReply,
    1500,
  );
  // Fail safe: a hung/crashed/slow renderer (NO_REPLY) is treated as possibly
  // dirty so the user is prompted rather than silently losing work.
  const dirty = dirtyReply === NO_REPLY ? true : Boolean(dirtyReply);

  if (!dirty) {
    finalizeClose(win);
    return;
  }

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: "Unsaved changes",
    message: "Do you want to save the changes to your project?",
    detail: "Your changes will be lost if you don't save them.",
  });

  if (response === 2) {
    // Cancelled — abort any in-progress quit so a later close re-prompts.
    quitting = false;
    return;
  }

  // Don't Save — discard and close.
  if (response === 1) {
    finalizeClose(win);
    return;
  }

  // Save — flush and only close if the renderer confirms success. On timeout
  // or failure, keep the window open so the unsaved work is preserved.
  const flushReply = await requestFromRenderer(
    win,
    CHANNELS.lifecycleFlush,
    CHANNELS.lifecycleFlushed,
    8000,
  );
  if (flushReply === true) {
    finalizeClose(win);
    return;
  }

  quitting = false;
  if (!win.isDestroyed()) {
    await dialog.showMessageBox(win, {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      title: "Could not save",
      message: "Your changes could not be saved.",
      detail:
        "Your project is still open so you can try again or save it manually.",
    });
  }
}

export function attachUnsavedGuard(win: BrowserWindow): void {
  win.on("close", (event) => {
    if (forceClose.has(win)) return;
    event.preventDefault();
    if (handling.has(win)) return;
    handling.add(win);
    void handleGuardedClose(win).finally(() => handling.delete(win));
  });
}
