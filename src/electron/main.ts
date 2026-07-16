import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { registerExcelIpc } from "./ipc/excel";
import { registerExportIpc } from "./ipc/exportCenter";
import { registerWindowIpc } from "./ipc/window";
import { loadConfig, updateConfig } from "./config";
import { ensureDir, getConfigDir, getDefaultBackupDir, getExportsDir, getLogsDir, log, rotateLogIfNeeded } from "./paths";

// The renderer is a fully bundled SPA; everything it needs from the OS goes
// through the typed IPC surface registered below (no nodeIntegration, no remote).
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
/** Workbook path passed on the command line (Open With / file association). */
let pendingOpenPath: string | null = null;

// Origins the renderer may open in a popup. Firebase Google sign-in (optional
// Google Sheets sync) is the only legitimate popup flow in the app.
const ALLOWED_POPUP_ORIGINS = ["https://accounts.google.com"];

function extractWorkbookPathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith("-") && /\.(xlsm|xlsx)$/i.test(arg)) {
      return path.resolve(arg);
    }
  }
  return null;
}

function sendOpenFilePath(filePath: string): void {
  if (!mainWindow) {
    pendingOpenPath = filePath;
    return;
  }
  mainWindow.webContents.send("open-file-path", filePath);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const config = await loadConfig();

  const win = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
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

  if (config.window.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  // Persist window size (debounced) so the portable config restores it.
  let resizeTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const maximized = win.isMaximized();
      const bounds = win.getNormalBounds();
      void updateConfig({ window: { width: bounds.width, height: bounds.height, maximized } });
    }, 800);
  };
  win.on("resize", persistBounds);
  win.on("maximize", persistBounds);
  win.on("unmaximize", persistBounds);

  // Deliver any file path Windows handed us once the renderer is ready.
  win.webContents.on("did-finish-load", () => {
    if (pendingOpenPath) {
      win.webContents.send("open-file-path", pendingOpenPath);
      pendingOpenPath = null;
    }
  });

  // Navigation hardening: the window may only ever display the app itself.
  win.webContents.on("will-navigate", (event, url) => {
    const isDev = DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL);
    const isSelf = url.startsWith("file://");
    if (!isDev && !isSelf) {
      event.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (ALLOWED_POPUP_ORIGINS.includes(origin) || origin.endsWith(".firebaseapp.com")) {
        return { action: "allow" };
      }
    } catch {
      /* fall through to deny */
    }
    if (url.startsWith("https://")) void shell.openExternal(url);
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

// Single-instance: a second launch (e.g. double-clicking a workbook associated
// with the app) is forwarded to the running instance instead of a new window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingOpenPath = extractWorkbookPathFromArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    const openPath = extractWorkbookPathFromArgv(argv);
    if (openPath) sendOpenFilePath(openPath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  registerWindowIpc();
  registerExcelIpc();
  registerExportIpc();

  app.whenReady().then(async () => {
    // Materialize the portable folder layout beside the executable.
    await Promise.all([
      ensureDir(getConfigDir()),
      ensureDir(getDefaultBackupDir()),
      ensureDir(getLogsDir()),
      ensureDir(getExportsDir())
    ]).catch(() => undefined);
    await rotateLogIfNeeded();
    log.info(`app started v${app.getVersion()} (portable=${Boolean(process.env.PORTABLE_EXECUTABLE_DIR)})`);

    mainWindow = await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow().then(win => (mainWindow = win));
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
