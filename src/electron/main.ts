import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  platform: process.platform
}));

// The renderer is a fully bundled SPA; everything it needs from the OS goes
// through the typed IPC surface registered below (no nodeIntegration, no remote).
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

// Origins the renderer may open in a popup. Firebase Google sign-in (optional
// Google Sheets sync) is the only legitimate popup flow in the app.
const ALLOWED_POPUP_ORIGINS = [
  "https://accounts.google.com",
  "https://monthly-power-energy-logger.firebaseapp.com"
];

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#020617", // slate-950: avoids white flash on load
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.once("ready-to-show", () => win.show());

  // Navigation hardening: the window may only ever display the app itself.
  win.webContents.on("will-navigate", (event, url) => {
    const isDev = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL);
    const isSelf = url.startsWith("file://");
    if (!isDev && !isSelf) {
      event.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (ALLOWED_POPUP_ORIGINS.some(o => origin === o || origin.endsWith(".firebaseapp.com"))) {
        return { action: "allow" };
      }
    } catch {
      /* fall through to deny */
    }
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Single-instance: a second launch (e.g. double-clicking a workbook associated
// with the app) is forwarded to the running instance instead of a new window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    mainWindow = createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
