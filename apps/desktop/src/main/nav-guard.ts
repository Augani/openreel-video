import { shell, type BrowserWindow } from "electron";

/**
 * Allows only same-origin (the app:// renderer) navigations. Everything else —
 * external sites, file://, other schemes — is denied, so a compromised/renderer
 * link can't navigate the window away from the app.
 */
export function isAllowedNavigation(targetUrl: string, appUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const app = new URL(appUrl);
    return target.protocol === app.protocol && target.host === app.host;
  } catch {
    return false;
  }
}

/**
 * Deny-by-default navigation hardening: block cross-origin top-level
 * navigations and in-app popups; genuine external https links open in the
 * user's default browser instead.
 */
export function installNavigationGuard(win: BrowserWindow, appUrl: string): void {
  const blockDisallowed = (event: { preventDefault: () => void }, url: string): void => {
    if (!isAllowedNavigation(url, appUrl)) {
      event.preventDefault();
    }
  };
  win.webContents.on("will-navigate", blockDisallowed);
  // will-redirect: a server/meta redirect must not slip past the same-origin gate.
  win.webContents.on("will-redirect", blockDisallowed);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}
