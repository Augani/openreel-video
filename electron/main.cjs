const { app, BrowserWindow, protocol, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isDev = !app.isPackaged;
const devUrl = process.env.OPENREEL_DEV_URL || "http://localhost:5173";
const devOrigin = new URL(devUrl).origin;
const distPath = path.resolve(__dirname, "..", "apps", "web", "dist");
const appOrigin = "app://openreel";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const mimeTypes = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isInsideDirectory(filePath, directoryPath) {
  const relativePath = path.relative(directoryPath, filePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function isTrustedAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (isDev) {
      return url.origin === devOrigin;
    }
    return url.origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternalUrl(rawUrl) {
  if (rawUrl.startsWith("http:") || rawUrl.startsWith("https:")) {
    shell.openExternal(rawUrl);
  }
}

function serveDist(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  let filePath = path.resolve(distPath, `.${pathname}`);
  if (!isInsideDirectory(filePath, distPath)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distPath, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  return new Response(fs.readFileSync(filePath), {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#000000",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedAppUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  if (isDev) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadURL("app://openreel/index.html");
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    if (!isDev) {
      protocol.handle("app", serveDist);
    }

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(permission === "media" && isTrustedAppUrl(webContents.getURL()));
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
