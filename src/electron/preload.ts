import { contextBridge, ipcRenderer } from "electron";

// The one and only bridge between the sandboxed renderer and the main process.
// Every capability is an explicit, named function - the renderer never gets a
// raw ipcRenderer, filesystem, or Node API.
const desktopBridge = {
  app: {
    getInfo: (): Promise<{ version: string; platform: string }> =>
      ipcRenderer.invoke("app:info")
  }
};

export type DesktopBridge = typeof desktopBridge;

contextBridge.exposeInMainWorld("desktop", desktopBridge);
