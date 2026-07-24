export type WindowControlAction = "minimize" | "toggleMaximize" | "close";

export interface ControllableWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isMaximized(): boolean;
}

export function applyWindowControl(win: ControllableWindow | null, action: WindowControlAction): void {
  if (!win) return;
  if (action === "minimize") {
    win.minimize();
    return;
  }
  if (action === "close") {
    win.close();
    return;
  }
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
}

export function windowIsMaximized(win: ControllableWindow | null): boolean {
  return win ? win.isMaximized() : false;
}
