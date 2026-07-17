import { contextBridge, ipcRenderer, webUtils } from "electron";

// The one and only bridge between the sandboxed renderer and the main process.
// Every capability is an explicit, named function - the renderer never gets a
// raw ipcRenderer, filesystem, or Node API.

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const desktopBridge = {
  app: {
    getInfo: () => invoke("app:info")
  },
  facilities: {
    list: () => invoke("facilities:list"),
    setActive: (id: string) => invoke("facilities:setActive", id)
  },
  excel: {
    open: (path: string | null, devices?: unknown) => invoke("excel:open", path, devices),
    reload: (path: string, devices?: unknown) => invoke("excel:reload", path, devices),
    save: (payload: { path: string; logs: unknown[]; devices?: unknown }) => invoke("excel:save", payload),
    saveAs: (payload: { sourcePath: string; logs: unknown[]; devices?: unknown }) => invoke("excel:saveAs", payload),
    checkLock: (path: string) => invoke("excel:checkLock", path),
    access: (path: string) => invoke("excel:access", path),
    validate: (path: string, devices?: unknown) => invoke("excel:validate", path, devices)
  },
  backups: {
    list: (workbookPath: string) => invoke("backup:list", workbookPath),
    restore: (payload: { workbookPath: string; backupPath: string }) => invoke("backup:restore", payload)
  },
  recovery: {
    get: () => invoke("recovery:get"),
    set: (payload: { workbookPath: string; logs: unknown[] }) => invoke("recovery:set", payload),
    clear: () => invoke("recovery:clear")
  },
  config: {
    get: () => invoke("config:get"),
    update: (patch: unknown) => invoke("config:update", patch),
    reset: () => invoke("config:reset"),
    clearRecent: () => invoke("recent:clear")
  },
  exportFile: (payload: { defaultName: string; content: string }) => invoke("export:file", payload),
  exportCenter: {
    pdf: (payload: { defaultName: string }) => invoke("export:pdf", payload),
    png: (payload: { defaultName: string }) => invoke("export:png", payload),
    excel: (payload: { defaultName: string; facility: string; logs: unknown[] }) => invoke("export:excel", payload),
    zip: (payload: {
      defaultName: string;
      facility: string;
      logs: unknown[];
      csvs: { name: string; content: string }[];
      integrityText: string | null;
    }) => invoke("export:zip", payload)
  },
  shell: {
    showItemInFolder: (path: string) => invoke("shell:showItemInFolder", path)
  },
  files: {
    /** Resolve the real filesystem path of a dropped File (drag & drop open). */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  events: {
    /** Fired when Windows asks the app to open a workbook (Open With / double-click / second instance). */
    onOpenFilePath: (callback: (path: string) => void) => {
      const listener = (_event: unknown, filePath: string) => callback(filePath);
      ipcRenderer.on("open-file-path", listener);
      return () => ipcRenderer.removeListener("open-file-path", listener);
    }
  }
};

export type DesktopBridge = typeof desktopBridge;

contextBridge.exposeInMainWorld("desktop", desktopBridge);
