export type Theme = "light" | "dark";
export type AppLanguage = "th" | "en";

export function themeStorageKey(userId: string): string { return `energy-monitor:theme:${userId}`; }
export function languageStorageKey(userId: string): string { return `energy-monitor:language:${userId}`; }

/** Desktop's packaged DEFAULT_CONFIG starts in the warm light theme.  Keep
 * an explicit saved "dark" preference, while keeping the existing CleanWeb
 * default stable for stored and unknown values. */
export function normalizeTheme(value: string | null): Theme { return value === "light" ? "light" : "dark"; }
// English is the default for a missing or unrecognised value. A preference the
// user explicitly saved as "th" is still honoured on restore.
export function normalizeLanguage(value: string | null): AppLanguage { return value === "th" ? "th" : "en"; }

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("theme-light", theme === "light");
  document.documentElement.classList.toggle("theme-dark", theme === "dark");
}
