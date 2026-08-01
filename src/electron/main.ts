import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import os from "os";
import { registerExcelIpc } from "./ipc/excel";
import { registerExportIpc } from "./ipc/exportCenter";
import { registerWindowIpc } from "./ipc/window";
import { registerGoogleSheetsIpc } from "./ipc/googleSheets";
import { registerImageIpc } from "./ipc/images";
import { restoreGoogleAuthOnStartup } from "./googleAuth";
import { loadConfig, updateConfig } from "./config";
import { ensureDir, getConfigDir, getDefaultBackupDir, getExportsDir, getLogsDir, log, rotateLogIfNeeded } from "./paths";

// The renderer is a fully bundled SPA; everything it needs from the OS goes
// through the typed IPC surface registered below (no nodeIntegration, no remote).
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Must run before Electron is ready so GPU initialization is never a
// prerequisite for the renderer. This does not change sandboxing or IPC.
app.commandLine.appendSwitch("disable-gpu");
app.disableHardwareAcceleration();

function startupDiagnosticFile(): string {
  const name = `startup-diagnostics-${process.pid}.log`;
  if (app.isReady()) return path.join(app.getPath("userData"), name);
  return path.join(process.env.APPDATA ?? os.tmpdir(), "Data Center Energy & Facility Monitor", name);
}

function startupDiagnostic(stage: string, message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : error === undefined ? "" : String(error);
  const line = `${new Date().toISOString()} stage=${stage} module=src/electron/main.ts file=${__filename} ${message}${detail ? `\n${detail}` : ""}\n`;
  const diagnosticFile = startupDiagnosticFile();
  try {
    mkdirSync(path.dirname(diagnosticFile), { recursive: true });
    appendFileSync(diagnosticFile, line, "utf8");
  } catch (loggingError) {
    console.error(`[STARTUP][diagnostic-write-failed] file=${diagnosticFile}`, loggingError);
  }
  console.error(line);
}

startupDiagnostic("module-import", `pid=${process.pid} argv=${JSON.stringify(process.argv)} packaged=${app.isPackaged}`);
// Software compositing keeps renderer startup independent of an optional
// hardware GPU runtime on portable Windows installations. BrowserWindow
// sandboxing and context isolation remain unchanged.
startupDiagnostic("hardware-acceleration", "software compositing enabled");
process.on("uncaughtExceptionMonitor", error => startupDiagnostic("uncaughtException", "uncaught exception observed", error));
process.on("unhandledRejection", reason => {
  startupDiagnostic("unhandledRejection", "unhandled rejection observed", reason);
  setImmediate(() => { throw reason; });
});
app.on("browser-window-created", (_event, window) => startupDiagnostic("browser-window-created", `id=${window.id}`));
app.on("web-contents-created", (_event, contents) => {
  startupDiagnostic("web-contents-created", `id=${contents.id}`);
  contents.on("console-message", (_event, level, message, line, sourceId) => startupDiagnostic("renderer-console", `level=${level} source=${sourceId}:${line} ${message}`));
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => startupDiagnostic("did-fail-load", `code=${errorCode} description=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`));
  contents.on("render-process-gone", (_event, details) => startupDiagnostic("render-process-gone", JSON.stringify(details)));
  contents.on("preload-error", (_event, preloadPath, error) => startupDiagnostic("preload-error", `preload=${preloadPath}`, error));
});
app.on("child-process-gone", (_event, details) => startupDiagnostic("child-process-gone", JSON.stringify(details)));

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
  startupDiagnostic("create-main-window:start", "loading application config");
  const config = await loadConfig();
  const preloadPath = path.join(__dirname, "preload.cjs");
  const rendererPath = path.join(__dirname, "..", "dist", "index.html");
  startupDiagnostic("create-main-window:resources", `preload=${preloadPath} exists=${existsSync(preloadPath)} renderer=${rendererPath} exists=${existsSync(rendererPath)} resourcesPath=${process.resourcesPath}`);

  const win = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#020617", // slate-950: avoids white flash on load
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  startupDiagnostic("create-main-window:created", `id=${win.id}`);

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
    startupDiagnostic("renderer-initialized", `window=${win.id}`);
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
    startupDiagnostic("renderer-load:url", DEV_SERVER_URL);
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    startupDiagnostic("renderer-load:file", rendererPath);
    void win.loadFile(rendererPath);
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// Single-instance: a second launch (e.g. double-clicking a workbook associated
// with the app) is forwarded to the running instance instead of a new window.
startupDiagnostic("single-instance-lock:start", "requesting single instance lock");
const gotLock = app.requestSingleInstanceLock();
startupDiagnostic("single-instance-lock:result", `acquired=${gotLock}`);
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
  startupDiagnostic("ipc-registration", "registerWindowIpc complete");
  registerExcelIpc();
  startupDiagnostic("ipc-registration", "registerExcelIpc complete");
  registerImageIpc();
  startupDiagnostic("ipc-registration", "registerImageIpc complete");
  registerExportIpc();
  startupDiagnostic("ipc-registration", "registerExportIpc complete");
  registerGoogleSheetsIpc();
  startupDiagnostic("ipc-registration", "registerGoogleSheetsIpc complete");

  app.whenReady().then(async () => {
    startupDiagnostic("electron-ready", `userData=${app.getPath("userData")} appPath=${app.getAppPath()}`);
    // Materialize the portable folder layout beside the executable.
    await Promise.all([
      ensureDir(getConfigDir()),
      ensureDir(getDefaultBackupDir()),
      ensureDir(getLogsDir()),
      ensureDir(getExportsDir())
    ]).catch(() => undefined);
    await rotateLogIfNeeded();
    log.info(`app started v${app.getVersion()} (portable=${Boolean(process.env.PORTABLE_EXECUTABLE_DIR)})`);
    await restoreGoogleAuthOnStartup();

    mainWindow = await createMainWindow();
    startupDiagnostic("application-idle", `mainWindow=${mainWindow.id}`);

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
