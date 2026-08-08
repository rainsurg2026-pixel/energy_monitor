import type { ReportHistoryItem } from "./reportingTypes";

const KEY = "energy-monitor-report-history-v1";
export const HistoryProvider = {
  list(): ReportHistoryItem[] {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ReportHistoryItem[]; } catch { return []; }
  },
  add(item: ReportHistoryItem): ReportHistoryItem[] {
    const next = [item, ...this.list()].slice(0, 50);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  },
  remove(id: string): ReportHistoryItem[] {
    const next = this.list().filter(item => item.id !== id);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  }
};
