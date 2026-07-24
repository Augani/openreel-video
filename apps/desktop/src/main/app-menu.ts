import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from "electron";

export interface MenuNode {
  label: string;
  accelerator?: string;
  role?: string;
  // When set, the item dispatches this id to the renderer (via onAction) instead
  // of using a native Electron role. Used for app-level actions (undo/redo/file).
  actionId?: string;
  submenu?: MenuNode[];
}

export function buildMenuTemplate(platform: string): MenuNode[] {
  const isMac = platform === "darwin";
  const template: MenuNode[] = [];
  if (isMac) {
    template.push({
      label: "OpenReel",
      submenu: [
        { label: "About OpenReel", role: "about" },
        { label: "Settings…", accelerator: "Cmd+,", actionId: "settings" },
        { label: "Quit", role: "quit", accelerator: "Cmd+Q" },
      ],
    });
  }
  template.push({
    label: "File",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N", actionId: "newProject" },
      { label: "Open…", accelerator: "CmdOrCtrl+O", actionId: "open" },
      { label: "Export…", accelerator: "CmdOrCtrl+E", actionId: "export" },
    ],
  });
  template.push({
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", actionId: "undo" },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", actionId: "redo" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      ...(!isMac
        ? [{ label: "Settings…", accelerator: "Ctrl+,", actionId: "settings" }]
        : []),
    ],
  });
  template.push({
    label: "View",
    submenu: [
      { label: "Reload", role: "reload", accelerator: "CmdOrCtrl+R" },
      { label: "Force Reload", role: "forceReload", accelerator: "Shift+CmdOrCtrl+R" },
      {
        label: "Toggle Developer Tools",
        role: "toggleDevTools",
        accelerator: "Alt+CmdOrCtrl+I",
      },
      { label: "Toggle Full Screen", role: "togglefullscreen" },
    ],
  });
  template.push({
    label: "Window",
    submenu: [
      { label: "Minimize", role: "minimize" },
      { label: "Close", role: "close" },
    ],
  });
  template.push({
    label: "Help",
    submenu: [
      { label: "OpenReel Help" },
      { label: "Open Source Licenses", actionId: "openLicenses" },
    ],
  });
  return template;
}

export function installApplicationMenu(platform: string, onAction: (id: string) => void): void {
  const toElectron = (node: MenuNode): MenuItemConstructorOptions => ({
    label: node.label,
    accelerator: node.accelerator,
    role: node.actionId
      ? undefined
      : (node.role as MenuItemConstructorOptions["role"]),
    submenu: node.submenu?.map(toElectron),
    click: node.actionId
      ? () => onAction(node.actionId as string)
      : node.role
        ? undefined
        : () => onAction(node.label),
  });
  const template = buildMenuTemplate(platform).map(toElectron);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function sendMenuAction(win: BrowserWindow | null, id: string): void {
  if (win) win.webContents.send("openreel:menu:action", id);
}
