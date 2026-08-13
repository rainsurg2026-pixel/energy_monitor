export type Theme = "light" | "dark";
export type AppLanguage = "th" | "en";

export function themeStorageKey(userId: string): string { return `energy-monitor:theme:${userId}`; }
export function languageStorageKey(userId: string): string { return `energy-monitor:language:${userId}`; }

export function normalizeTheme(value: string | null): Theme { return value === "light" ? "light" : "dark"; }
export function normalizeLanguage(value: string | null): AppLanguage { return value === "en" ? "en" : "th"; }

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("theme-light", theme === "light");
  document.documentElement.classList.toggle("theme-dark", theme === "dark");
}
