import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { MonthlyLog } from "./types";
import { getPreviousMonthStr } from "./utils";

export interface ReportContextType {
  // Filters
  selectedYear: string; // e.g. "2026", "All", "Current Year"
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
}

export const ReportProvider: React.FC<ReportProviderProps> = ({ children, syncedLogs }) => {
  // Dynamic Options derived exclusively from syncedLogs (Google Sheets)
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    syncedLogs.forEach(l => {
      const y = l.month.split("-")[0];
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [syncedLogs]);

  // Default Year to Current Local Year or latest year in logs
  const defaultYear = useMemo(() => {
    const currentYearStr = new Date().getFullYear().toString();
    if (availableYears.includes(currentYearStr)) return currentYearStr;
    return availableYears[0] || "All";
  }, [availableYears]);

  // Load persistent user preferences or defaults
  const [selectedYear, setSelectedYearState] = useState<string>(() => {
    return localStorage.getItem("report_pref_year") || "Current Year";
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
    return localStorage.getItem("report_pref_dark_mode") === "true" || true;
  });
  const [dashboardLayout, setDashboardLayoutState] = useState<string>(() => {
    return localStorage.getItem("report_pref_layout") || "grid";
  });
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Helper setters that also persist to LocalStorage
  const setSelectedYear = (val: string) => {
    setSelectedYearState(val);
    localStorage.setItem("report_pref_year", val);
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

  // When years change, ensure selection is updated if it is no longer valid
  useEffect(() => {
    if (selectedYear !== "All" && selectedYear !== "Current Year" && availableYears.length > 0) {
      if (!availableYears.includes(selectedYear)) {
        setSelectedYear("Current Year");
      }
    }
  }, [availableYears, selectedYear]);

  // Derived calculations and configurations
  const contextValue = useMemo<ReportContextType>(() => ({
    selectedYear: selectedYear === "Current Year" ? defaultYear : selectedYear,
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
    defaultYear,
    selectedPeriod,
    selectedTrend,
    compareMode,
    selectedCategory,
    selectedSite,
    selectedUPSGroup,
    selectedReportView,
    availableYears,
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
