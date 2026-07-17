import React from "react";
import { Building2, ChevronDown } from "lucide-react";
import type { FacilityEntry } from "../desktop";

interface FacilitySelectorProps {
  facilities: FacilityEntry[];
  activeId: string | null;
  isBusy: boolean;
  lang: "th" | "en";
  onSelect: (id: string) => void;
}

/**
 * Header facility switcher (RC1). Selecting a facility swaps the active
 * workbook and reloads every view - no restart, no mixed data.
 */
export default function FacilitySelector({ facilities, activeId, isBusy, lang, onSelect }: FacilitySelectorProps) {
  if (facilities.length === 0) return null;
  const active = facilities.find(f => f.id === activeId) ?? null;

  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5">
        <span className="text-sm leading-none">{active?.profile.logo ?? <Building2 className="w-3.5 h-3.5 text-indigo-400" />}</span>
      </div>
      <select
        value={activeId ?? ""}
        disabled={isBusy}
        onChange={e => {
          if (e.target.value && e.target.value !== activeId) onSelect(e.target.value);
        }}
        title={
          active
            ? `${lang === "th" ? "ศูนย์ข้อมูล" : "Facility"}: ${active.displayName ?? active.name} · ${active.workbook}`
            : lang === "th"
              ? "เลือกศูนย์ข้อมูล"
              : "Select facility"
        }
        className="appearance-none pl-9 pr-8 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-bold rounded-xl border border-slate-800 hover:border-slate-700 text-slate-100 cursor-pointer transition-all focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-wait"
      >
        {!active && <option value="">{lang === "th" ? "เลือกศูนย์ข้อมูล..." : "Select facility…"}</option>}
        {facilities.map(f => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
