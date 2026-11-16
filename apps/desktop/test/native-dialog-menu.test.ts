import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, OpenDialogReturnValue, SaveDialogReturnValue, IpcMainInvokeEvent } from "electron";

const native = vi.hoisted(() => ({
  open: vi.fn(), save: vi.fn(), responder: vi.fn(), send: vi.fn(), owner: vi.fn(), focused: vi.fn(), focus: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: native.open, showSaveDialog: native.save },
  BrowserWindow: { getFocusedWindow: native.focused, fromWebContents: native.owner },
  Menu: { sendActionToFirstResponder: native.responder },
  shell: {},
}));

import { showOpenDialog, showSaveDialog } from "../src/main/ipc/fs";
import { isNativeDialogOpen } from "../src/main/native-dialog-state";
import { sendMenuAction } from "../src/main/app-menu";

const win = { webContents: { send: native.send } } as unknown as BrowserWindow;
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.clearAllMocks(); native.focused.mockReturnValue(null); native.owner.mockReturnValue(null); expect(isNativeDialogOpen()).toBe(false); });

describe("native chooser edit commands", () => {
  it.each(["open", "save"] as const)("parents %s to the requesting editor even when another window has focus", async kind => {
    const sender = {}, event = { sender } as IpcMainInvokeEvent;
    const owner = { isDestroyed: () => false, focus: native.focus } as unknown as BrowserWindow;
    native.owner.mockReturnValue(owner);
    native.focused.mockReturnValue({ isDestroyed: () => false });
    native.open.mockResolvedValue({ canceled: true, filePaths: [] });
    native.save.mockResolvedValue({ canceled: true, filePath: "" });
    if (kind === "open") await showOpenDialog({ filters: [] }, event);
    else await showSaveDialog({ defaultPath: "project.oreel", filters: [] }, event);
    const dialog = kind === "open" ? native.open : native.save;
    expect(dialog.mock.calls[0][0]).toBe(owner);
    expect(native.owner).toHaveBeenCalledWith(sender);
    expect(native.focus).toHaveBeenCalledOnce();
    expect(isNativeDialogOpen()).toBe(false);
  });

  it.each(["selectAll", "undo", "redo"])("keeps %s in the native responder while an Open dialog is active", async action => {
    const chooser = deferred<OpenDialogReturnValue>();
    native.open.mockReturnValue(chooser.promise);
    const opening = showOpenDialog({ filters: [] });
    try {
      expect(isNativeDialogOpen()).toBe(true);
      sendMenuAction(win, action, "darwin");
      expect(native.responder).toHaveBeenCalledWith(`${action}:`);
      expect(native.send).not.toHaveBeenCalled();
    } finally {
      chooser.resolve({ canceled: true, filePaths: [] });
      expect(await opening).toBeNull();
    }
    expect(isNativeDialogOpen()).toBe(false);
    sendMenuAction(win, action, "darwin");
    expect(native.send).toHaveBeenCalledWith("openreel:menu:action", action);
  });

  it("tracks concurrent Open/Save lifetimes and releases a rejected dialog", async () => {
    const open = deferred<OpenDialogReturnValue>();
    const save = deferred<SaveDialogReturnValue>();
    native.open.mockReturnValue(open.promise);
    native.save.mockReturnValue(save.promise);
    const opening = showOpenDialog({ filters: [] });
    const saving = showSaveDialog({ defaultPath: "qa.mp4", filters: [] });
    try {
      open.resolve({ canceled: true, filePaths: [] });
      await opening;
      expect(isNativeDialogOpen()).toBe(true);
      sendMenuAction(null, "selectAll", "darwin");
      expect(native.responder).toHaveBeenCalledWith("selectAll:");
      const rejected = expect(saving).rejects.toThrow("chooser failed");
      save.reject(new Error("chooser failed"));
      await rejected;
    } finally {
      open.resolve({ canceled: true, filePaths: [] });
      save.resolve({ canceled: true, filePath: "" });
      await Promise.allSettled([opening, saving]);
    }
    expect(isNativeDialogOpen()).toBe(false);
  });

  it("retains other menu actions and non-macOS dispatch during a chooser", async () => {
    const chooser = deferred<SaveDialogReturnValue>();
    native.save.mockReturnValue(chooser.promise);
    const saving = showSaveDialog({ defaultPath: "qa.mp4", filters: [] });
    sendMenuAction(win, "selectAll", "win32");
    sendMenuAction(win, "settings", "darwin");
    expect(native.responder).not.toHaveBeenCalled();
    expect(native.send.mock.calls.map(call => call[1])).toEqual(["selectAll", "settings"]);
    chooser.resolve({ canceled: false, filePath: "/tmp/qa.mp4" });
    expect(await saving).toBe("/tmp/qa.mp4");
    expect(isNativeDialogOpen()).toBe(false);
  });
});
