import React, { createContext, useContext, useMemo, useState } from "react";
import type { ReportingPeriod } from "./reportingTypes";

export interface ReportingMonthValue {
  period: ReportingPeriod;
  month: string;
  from: string;
  to: string;
  setPeriod: (value: ReportingPeriod) => void;
  setMonth: (value: string) => void;
  setRange: (from: string, to: string) => void;
}

const ReportingMonthContext = createContext<ReportingMonthValue | undefined>(undefined);

export function ReportingMonthProvider({ children, initialMonth }: { children: React.ReactNode; initialMonth: string }) {
  const [period, setPeriod] = useState<ReportingPeriod>("current");
  const [month, setMonth] = useState(initialMonth);
  const [from, setFrom] = useState(initialMonth);
  const [to, setTo] = useState(initialMonth);
  const value = useMemo(() => ({ period, month, from, to, setPeriod, setMonth, setRange: (nextFrom: string, nextTo: string) => { setFrom(nextFrom); setTo(nextTo); } }), [period, month, from, to]);
  return <ReportingMonthContext.Provider value={value}>{children}</ReportingMonthContext.Provider>;
}

export function useReportingMonth(): ReportingMonthValue {
  const value = useContext(ReportingMonthContext);
  if (!value) throw new Error("useReportingMonth must be used within ReportingMonthProvider");
  return value;
}
