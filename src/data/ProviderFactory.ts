/**
 * ProviderFactory - decides which IDataProvider implementation backs the UI.
 *
 * Desktop (window.desktop present): Excel is the default and primary source;
 * Google Sheets remains an optional secondary sync.
 * Browser build (no bridge): Google Sheets, exactly as before the migration.
 */

import { DataSourceKind, IDataProvider } from "./IDataProvider";
import { ExcelProvider } from "./ExcelProvider";
import { GoogleSheetsProvider, GoogleSheetsProviderDeps } from "./GoogleSheetsProvider";
import type { DesktopBridge } from "../desktop";

export function getDesktopBridge(): DesktopBridge | null {
  return typeof window !== "undefined" && window.desktop ? window.desktop : null;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== null;
}

export function defaultDataSource(): DataSourceKind {
  return isDesktop() ? "excel" : "googleSheets";
}

export function createProvider(kind: DataSourceKind, sheetsDeps: GoogleSheetsProviderDeps): IDataProvider {
  if (kind === "excel") {
    const bridge = getDesktopBridge();
    if (!bridge) {
      throw new Error("Excel provider requires the desktop app (no preload bridge found).");
    }
    return new ExcelProvider(bridge);
  }
  return new GoogleSheetsProvider(sheetsDeps);
}
