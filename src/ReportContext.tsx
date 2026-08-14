import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { MonthlyLog } from "./types";
import { getPreviousMonthStr } from "./utils";

/** Default reporting year used only when no persisted or available year can
 * be resolved. Historical years remain selectable when they are in the
 * configured display period. */
export const REPORTING_YEAR = "2026";

/** Return years available from the server's complete month availability list.
 * Dashboard logs may be intentionally limited to the initial six-month
 * window, so deriving this list from logs alone hides older selectable years. */
export function reportYearsFromMonths(logs: readonly ({ month: string } | string)[], availableMonths: readonly string[] = []): string[] {
  const years = new Set<string>();
  for (const month of [...logs.map(item => typeof item === "string" ? item : item.month), ...availableMonths]) {
    const year = month.slice(0, 4);
    if (/^\d{4}$/u.test(year)) years.add(year);
  }
  return Array.from(years).sort((left, right) => right.localeCompare(left));
}

/** Accept only a year that is present in the loaded report data. */
export function resolveReportYear(requested: string, availableYears: readonly string[], fallbackYear: string): string {
  const normalized = requested.trim();
  if (/^\d{4}$/u.test(normalized) && availableYears.includes(normalized)) return normalized;
  if (availableYears.includes(fallbackYear)) return fallbackYear;
  return availableYears[0] ?? fallbackYear;
}

export interface ReportContextType {
  // Filters
  selectedYear: string; // e.g. "2026", "All", "Current Year"
  /** Same value as the persisted app-level display-period setting. */
  displayPeriod: string;
  selectedPeriod: string; // e.g. "Entire Year", "01", "02", ..., "12", "YTD", "Last Month"
  selectedTrend: string; // e.g. "Last 3 Months", "Last 6 Months", "Last 12 Months", "Rolling Window"
  compareMode: "none" | "prev_month" | "prev_year" | "rolling_avg" | "best_worst";
  selectedCategory: "All" | "UPS" | "Air Conditioning" | "DC" | "Energy Cost" | "PUE" | "Carbon";
  selectedSite: string; // default "Site A" (Future Ready)
  selectedUPSGroup: "All" | "Group 11" | "Group 13" | "Group 15" | string;
  selectedReportView: "executive" | "dashboard" | "benchmark" | "forecast" | "history";
  
  // Setters
  setSelectedYear: (val: string) => void;
  setSelectedPeriod: (val: string) => void;
  setSelectedTrend: (val: string) => void;
  setCompareMode: (val: "none" | "prev_month" | "prev_year" | "rolling_avg" | "best_worst") => void;
  setSelectedCategory: (val: "All" | "UPS" | "Air Conditioning" | "DC" | "Energy Cost" | "PUE" | "Carbon") => void;
  setSelectedSite: (val: string) => void;
  setSelectedUPSGroup: (val: string) => void;
  setSelectedReportView: (val: "executive" | "dashboard" | "benchmark" | "forecast" | "history") => void;

  // Dynamic Options from logs
  availableYears: string[];
  
  // Custom preferences
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  dashboardLayout: string;
  setDashboardLayout: (val: string) => void;
  
  // Action triggers
  triggerRefresh: () => void;
  refreshCounter: number;
}

const ReportContext = createContext<ReportContextType | undefined>(undefined);

export const useReport = () => {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error("useReport must be used within a ReportProvider");
  }
  return context;
};

interface ReportProviderProps {
  children: React.ReactNode;
  // Google Sheets is the only source of truth for reports: this must always be syncedLogs,
  // never the local in-memory entry-draft store.
  syncedLogs: MonthlyLog[];
  /** Persisted app-level visible reporting year/range. */
  displayPeriod?: string;
  /** Complete month availability returned by the API, independent of the
   * intentionally bounded initial log payload. */
  availableMonths?: readonly string[];
  /** Allows a host to fetch older logs lazily after a historical year is
   * selected. */
  onYearChange?: (year: string) => void;
}

export const ReportProvider: React.FC<ReportProviderProps> = ({ children, syncedLogs, displayPeriod, availableMonths = [], onYearChange }) => {
  const activeDisplayPeriod = displayPeriod?.trim() || REPORTING_YEAR;
  const availableYears = useMemo(() => reportYearsFromMonths(syncedLogs, availableMonths), [availableMonths, syncedLogs]);

  // Load persistent user preferences or defaults
  const [selectedYear, setSelectedYearState] = useState<string>(() => {
    return localStorage.getItem("report_pref_year") || activeDisplayPeriod;
  });
  const [selectedPeriod, setSelectedPeriodState] = useState<string>(() => {
    return localStorage.getItem("report_pref_period") || "Entire Year";
  });
  const [selectedTrend, setSelectedTrendState] = useState<string>(() => {
    return localStorage.getItem("report_pref_trend") || "Last 3 Months";
  });
  const [compareMode, setCompareModeState] = useState<"none" | "prev_month" | "prev_year" | "rolling_avg" | "best_worst">((() => {
    return (localStorage.getItem("report_pref_compare") as any) || "none";
  }));
  const [selectedCategory, setSelectedCategoryState] = useState<"All" | "UPS" | "Air Conditioning" | "DC" | "Energy Cost" | "PUE" | "Carbon">(() => {
    return (localStorage.getItem("report_pref_category") as any) || "All";
  });
  const [selectedSite, setSelectedSiteState] = useState<string>(() => {
    return localStorage.getItem("report_pref_site") || "Site A";
  });
  const [selectedUPSGroup, setSelectedUPSGroupState] = useState<string>(() => {
    return localStorage.getItem("report_pref_ups_group") || "All";
  });
  const [selectedReportView, setSelectedReportViewState] = useState<"executive" | "dashboard" | "benchmark" | "forecast" | "history">(() => {
    return (localStorage.getItem("report_pref_report_view") as any) || "executive";
  });
  const [darkMode, setDarkModeState] = useState<boolean>(() => {
    return localStorage.getItem("report_pref_dark_mode") === "true";
  });
  const [dashboardLayout, setDashboardLayoutState] = useState<string>(() => {
    return localStorage.getItem("report_pref_layout") || "grid";
  });
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Helper setters that also persist to LocalStorage
  const setSelectedYear = (val: string) => {
    const nextYear = resolveReportYear(val, availableYears, activeDisplayPeriod);
    setSelectedYearState(nextYear);
    localStorage.setItem("report_pref_year", nextYear);
    if (nextYear !== selectedYear) onYearChange?.(nextYear);
  };
  const setSelectedPeriod = (val: string) => {
    setSelectedPeriodState(val);
    localStorage.setItem("report_pref_period", val);
  };
  const setSelectedTrend = (val: string) => {
    setSelectedTrendState(val);
    localStorage.setItem("report_pref_trend", val);
  };
  const setCompareMode = (val: "none" | "prev_month" | "prev_year" | "rolling_avg" | "best_worst") => {
    setCompareModeState(val);
    localStorage.setItem("report_pref_compare", val);
  };
  const setSelectedCategory = (val: "All" | "UPS" | "Air Conditioning" | "DC" | "Energy Cost" | "PUE" | "Carbon") => {
    setSelectedCategoryState(val);
    localStorage.setItem("report_pref_category", val);
  };
  const setSelectedSite = (val: string) => {
    setSelectedSiteState(val);
    localStorage.setItem("report_pref_site", val);
  };
  const setSelectedUPSGroup = (val: string) => {
    setSelectedUPSGroupState(val);
    localStorage.setItem("report_pref_ups_group", val);
  };
  const setSelectedReportView = (val: "executive" | "dashboard" | "benchmark" | "forecast" | "history") => {
    setSelectedReportViewState(val);
    localStorage.setItem("report_pref_report_view", val);
  };
  const setDarkMode = (val: boolean) => {
    setDarkModeState(val);
    localStorage.setItem("report_pref_dark_mode", String(val));
  };
  const setDashboardLayout = (val: string) => {
    setDashboardLayoutState(val);
    localStorage.setItem("report_pref_layout", val);
  };
  const triggerRefresh = () => {
    setRefreshCounter(prev => prev + 1);
  };

  // Keep an invalid/stale selection safe without forcing valid historical
  // years back to the current display-period year.
  useEffect(() => {
    const nextYear = resolveReportYear(selectedYear, availableYears, activeDisplayPeriod);
    if (nextYear !== selectedYear) {
      setSelectedYearState(nextYear);
    }
    if (localStorage.getItem("report_pref_year") !== nextYear) {
      localStorage.setItem("report_pref_year", nextYear);
    }
  }, [activeDisplayPeriod, availableYears, selectedYear]);

  // Derived calculations and configurations
  const contextValue = useMemo<ReportContextType>(() => ({
    selectedYear,
    displayPeriod: activeDisplayPeriod,
    selectedPeriod,
    selectedTrend,
    compareMode,
    selectedCategory,
    selectedSite,
    selectedUPSGroup,
    selectedReportView,
    
    setSelectedYear,
    setSelectedPeriod,
    setSelectedTrend,
    setCompareMode,
    setSelectedCategory,
    setSelectedSite,
    setSelectedUPSGroup,
    setSelectedReportView,
    
    availableYears,
    darkMode,
    setDarkMode,
    dashboardLayout,
    setDashboardLayout,
    
    triggerRefresh,
    refreshCounter
  }), [
    selectedYear,
    activeDisplayPeriod,
    selectedPeriod,
    selectedTrend,
    compareMode,
    selectedCategory,
    selectedSite,
    selectedUPSGroup,
    selectedReportView,
    availableYears,
    onYearChange,
    darkMode,
    dashboardLayout,
    refreshCounter
  ]);

  return (
    <ReportContext.Provider value={contextValue}>
      {children}
    </ReportContext.Provider>
  );
};
