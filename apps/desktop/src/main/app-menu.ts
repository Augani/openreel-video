import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from "electron";
import type { Locale } from "@openreel/i18n";
import { translate } from "@openreel/i18n/translate";
import { isNativeDialogOpen } from "./native-dialog-state";

const nativeEditSelectors = new Map([
  ["selectAll", "selectAll:"], ["undo", "undo:"], ["redo", "redo:"],
]);

interface MenuNode {
  label: string;
  accelerator?: string;
  role?: string;
  // When set, the item dispatches this id to the renderer (via onAction) instead
  // of using a native Electron role. Used for app-level actions (undo/redo/file).
  actionId?: string;
  submenu?: MenuNode[];
}

export function buildMenuTemplate(platform: string, locale: Locale = "en"): MenuNode[] {
  const isMac = platform === "darwin";
  const template: MenuNode[] = [];
  if (isMac) {
    template.push({
      label: translate(locale, "OpenReel"),
      submenu: [
        { label: translate(locale, "About OpenReel"), role: "about" },
        { label: translate(locale, "Settings…"), accelerator: "Cmd+,", actionId: "settings" },
        { label: translate(locale, "Quit"), role: "quit", accelerator: "Cmd+Q" },
      ],
    });
  }
  template.push({
    label: translate(locale, "File"),
    submenu: [
      { label: translate(locale, "New Project"), accelerator: "CmdOrCtrl+N", actionId: "newProject" },
      { label: translate(locale, "Open…"), accelerator: "CmdOrCtrl+O", actionId: "open" },
      { label: translate(locale, "Export…"), accelerator: "CmdOrCtrl+E", actionId: "export" },
      { label: translate(locale, "Project Manager…"), actionId: "projectManager" },
      { label: translate(locale, "Collaborate…"), accelerator: "Shift+CmdOrCtrl+J", actionId: "collaborate" },
    ],
  });
  template.push({
    label: translate(locale, "Edit"),
    submenu: [
      { label: translate(locale, "Undo"), accelerator: "CmdOrCtrl+Z", actionId: "undo" },
      { label: translate(locale, "Redo"), accelerator: "Shift+CmdOrCtrl+Z", actionId: "redo" },
      { label: translate(locale, "Cut"), role: "cut" },
      { label: translate(locale, "Copy"), role: "copy" },
      { label: translate(locale, "Paste"), role: "paste" },
      { label: translate(locale, "Select All"), accelerator: "CmdOrCtrl+A", actionId: "selectAll" },
      ...(!isMac
        ? [{ label: translate(locale, "Settings…"), accelerator: "Ctrl+,", actionId: "settings" }]
        : []),
    ],
  });
  template.push({
    label: translate(locale, "Effects"),
    submenu: [{ label: translate(locale, "Manage Plugins…"), actionId: "managePlugins" }],
  });
  template.push({
    label: translate(locale, "View"),
    submenu: [
      { label: translate(locale, "Reload"), role: "reload", accelerator: "CmdOrCtrl+R" },
      { label: translate(locale, "Force Reload"), role: "forceReload", accelerator: "Shift+CmdOrCtrl+R" },
      {
        label: translate(locale, "Toggle Developer Tools"),
        role: "toggleDevTools",
        accelerator: "Alt+CmdOrCtrl+I",
      },
      { label: translate(locale, "Toggle Full Screen"), role: "togglefullscreen" },
    ],
  });
  template.push({
    label: translate(locale, "Window"),
    submenu: [
      { label: translate(locale, "Minimize"), role: "minimize" },
      { label: translate(locale, "Close"), role: "close" },
    ],
  });
  template.push({
    label: translate(locale, "Help"),
    submenu: [
      { label: translate(locale, "Welcome & Setup…"), actionId: "showWelcomeSetup" },
      { label: translate(locale, "Learn OpenReel…"), actionId: "openLessons" },
      { label: translate(locale, "Connect an AI Agent…"), actionId: "connectAgent" },
      { label: translate(locale, "Open Source Licenses"), actionId: "openLicenses" },
    ],
  });
  return template;
}

export function installApplicationMenu(
  platform: string,
  onAction: (id: string) => void,
  locale: Locale = "en",
): void {
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
  const template = buildMenuTemplate(platform, locale).map(toElectron);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function sendMenuAction(win: BrowserWindow | null, id: string, platform = process.platform): void {
  const selector = nativeEditSelectors.get(id);
  // A macOS chooser owns its text fields even when the editor is behind it.
  if (platform === "darwin" && selector && isNativeDialogOpen()) {
    Menu.sendActionToFirstResponder(selector);
    return;
  }
  if (win) win.webContents.send("openreel:menu:action", id);
}
