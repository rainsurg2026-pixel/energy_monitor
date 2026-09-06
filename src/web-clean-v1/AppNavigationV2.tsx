import { BarChart3, Boxes, Building2, ChartNoAxesCombined, ChevronDown, ClipboardPenLine, FileSpreadsheet, History, LogOut, MoreHorizontal, Server, Settings, UsersRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";

export type AppViewV2 = "dashboard" | "entry" | "racks" | "rack-units" | "history" | "comparison" | "rack-comparison" | "reports" | "settings" | "admin";

type MenuId = "capacity" | "reports" | "settings" | null;
type MobileSheet = "capacity" | "reports" | "more" | null;

interface Props {
  activeView: AppViewV2;
  lang: "th" | "en";
  isAdmin: boolean;
  onNavigate: (view: AppViewV2) => void;
  onLogout: () => void | Promise<void>;
}

function isCapacity(view: AppViewV2): boolean { return view === "racks" || view === "rack-units"; }
function isReports(view: AppViewV2): boolean { return view === "history" || view === "comparison" || view === "rack-comparison" || view === "reports"; }
function isSettings(view: AppViewV2): boolean { return view === "settings" || view === "admin"; }

function NavIconButton({ active, label, icon: Icon, onClick, chevron = false }: { active: boolean; label: string; icon: typeof BarChart3; onClick: () => void; chevron?: boolean }) {
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${active ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15" : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"}`}>
    <Icon className="h-5 w-5 shrink-0" /><span>{label}</span>{chevron && <ChevronDown className="h-3.5 w-3.5" />}
  </button>;
}

function MenuPanel({ children }: { children: ReactNode }) {
  return <div className="absolute left-0 top-[calc(100%+6px)] z-40 min-w-72 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">{children}</div>;
}

function MenuItem({ label, icon: Icon, active = false, onClick }: { label: string; icon: typeof BarChart3; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${active ? "bg-indigo-600/20 text-indigo-200" : "text-slate-300 hover:bg-slate-800"}`}><Icon className="h-4 w-4 shrink-0"/><span>{label}</span></button>;
}

function DesktopNavigation({ activeView, lang, isAdmin, onNavigate, onLogout }: Props) {
  const [open, setOpen] = useState<MenuId>(null);
  const th = lang === "th";
  const go = (view: AppViewV2) => { setOpen(null); onNavigate(view); };
  return <nav aria-label={th ? "เมนูหลักเดสก์ท็อป" : "Desktop primary navigation"} className="mb-5 hidden grid-cols-5 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-1.5 shadow-md md:grid">
    <NavIconButton active={activeView === "dashboard"} label={th ? "แดชบอร์ด" : "Dashboard"} icon={BarChart3} onClick={() => go("dashboard")} />
    <NavIconButton active={activeView === "entry"} label={th ? "กรอกข้อมูล" : "Data Entry"} icon={ClipboardPenLine} onClick={() => go("entry")} />
    <div className="relative"><NavIconButton active={isCapacity(activeView)} label={th ? "ความจุ" : "Capacity"} icon={Server} chevron onClick={() => setOpen(open === "capacity" ? null : "capacity")} />{open === "capacity" && <MenuPanel><MenuItem label={th ? "ความจุแร็ค" : "Rack Capacity"} icon={Server} active={activeView === "racks"} onClick={() => go("racks")} /><MenuItem label={th ? "ความจุ U" : "Rack Unit Capacity"} icon={Boxes} active={activeView === "rack-units"} onClick={() => go("rack-units")} /></MenuPanel>}</div>
    <div className="relative"><NavIconButton active={isReports(activeView)} label={th ? "รายงาน" : "Reports"} icon={FileSpreadsheet} chevron onClick={() => setOpen(open === "reports" ? null : "reports")} />{open === "reports" && <MenuPanel><MenuItem label={th ? "ประวัติ" : "History"} icon={History} active={activeView === "history"} onClick={() => go("history")} /><MenuItem label={th ? "เปรียบเทียบพลังงานและค่าใช้จ่าย" : "Site Energy & Cost Comparison"} icon={ChartNoAxesCombined} active={activeView === "comparison"} onClick={() => go("comparison")} /><MenuItem label={th ? "เปรียบเทียบความจุแร็ค" : "Site Rack Capacity & Availability"} icon={Building2} active={activeView === "rack-comparison"} onClick={() => go("rack-comparison")} /><MenuItem label={th ? "ศูนย์ส่งออก" : "Export Center"} icon={FileSpreadsheet} active={activeView === "reports"} onClick={() => go("reports")} /></MenuPanel>}</div>
    <div className="relative"><NavIconButton active={isSettings(activeView)} label={th ? "ตั้งค่า / โปรไฟล์" : "Settings / Profile"} icon={Settings} chevron onClick={() => setOpen(open === "settings" ? null : "settings")} />{open === "settings" && <MenuPanel><MenuItem label={th ? "ตั้งค่า" : "Settings"} icon={Settings} active={activeView === "settings"} onClick={() => go("settings")} />{isAdmin && <MenuItem label={th ? "จัดการผู้ใช้" : "User Management"} icon={UsersRound} active={activeView === "admin"} onClick={() => go("admin")} />}<MenuItem label={th ? "ออกจากระบบ" : "Logout"} icon={LogOut} onClick={() => { setOpen(null); void onLogout(); }} /></MenuPanel>}</div>
  </nav>;
}

function MobileSheetPanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={title}>
    <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
    <section className="absolute bottom-0 left-0 right-0 max-h-[72vh] overflow-y-auto rounded-t-3xl border-t border-slate-700 bg-slate-900 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-base font-bold text-slate-100">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 text-slate-300"><X className="h-4 w-4"/></button></div>
      <div className="space-y-1.5">{children}</div>
    </section>
  </div>;
}

function MobileNavigation({ activeView, lang, isAdmin, onNavigate, onLogout }: Props) {
  const [sheet, setSheet] = useState<MobileSheet>(null);
  const th = lang === "th";
  const go = (view: AppViewV2) => { setSheet(null); onNavigate(view); };
  const items = [
    { id: "dashboard", label: th ? "แดชบอร์ด" : "Dashboard", icon: BarChart3, active: activeView === "dashboard", action: () => go("dashboard") },
    { id: "entry", label: th ? "กรอก" : "Entry", icon: ClipboardPenLine, active: activeView === "entry", action: () => go("entry") },
    { id: "capacity", label: th ? "ความจุ" : "Capacity", icon: Server, active: isCapacity(activeView), action: () => setSheet("capacity" as const) },
    { id: "reports", label: th ? "รายงาน" : "Reports", icon: FileSpreadsheet, active: activeView === "history" || activeView === "reports", action: () => setSheet("reports" as const) },
    { id: "more", label: th ? "เพิ่มเติม" : "More", icon: MoreHorizontal, active: activeView === "comparison" || activeView === "rack-comparison" || isSettings(activeView), action: () => setSheet("more" as const) },
  ];
  return <>
    <nav aria-label={th ? "เมนูหลักมือถือ" : "Mobile primary navigation"} className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-slate-800 bg-slate-950/98 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_rgba(0,0,0,0.28)] md:hidden">
      {items.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={item.action} aria-current={item.active ? "page" : undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2.5 text-[9px] font-semibold ${item.active ? "text-indigo-300" : "text-slate-500"}`}><Icon className="h-5 w-5"/><span className="max-w-full truncate">{item.label}</span></button>; })}
    </nav>
    {sheet === "capacity" && <MobileSheetPanel title={th ? "ความจุ" : "Capacity"} onClose={() => setSheet(null)}><MenuItem label={th ? "ความจุแร็ค" : "Rack Capacity"} icon={Server} active={activeView === "racks"} onClick={() => go("racks")} /><MenuItem label={th ? "ความจุ U" : "Rack Unit Capacity"} icon={Boxes} active={activeView === "rack-units"} onClick={() => go("rack-units")} /></MobileSheetPanel>}
    {sheet === "reports" && <MobileSheetPanel title={th ? "รายงาน" : "Reports"} onClose={() => setSheet(null)}><MenuItem label={th ? "ประวัติ" : "History"} icon={History} active={activeView === "history"} onClick={() => go("history")} /><MenuItem label={th ? "ศูนย์ส่งออก" : "Export Center"} icon={FileSpreadsheet} active={activeView === "reports"} onClick={() => go("reports")} /></MobileSheetPanel>}
    {sheet === "more" && <MobileSheetPanel title={th ? "เพิ่มเติม" : "More"} onClose={() => setSheet(null)}><MenuItem label={th ? "เปรียบเทียบพลังงานและค่าใช้จ่าย" : "Site Energy & Cost Comparison"} icon={ChartNoAxesCombined} active={activeView === "comparison"} onClick={() => go("comparison")} /><MenuItem label={th ? "เปรียบเทียบความจุแร็ค" : "Site Rack Capacity & Availability"} icon={Building2} active={activeView === "rack-comparison"} onClick={() => go("rack-comparison")} /><MenuItem label={th ? "ตั้งค่า" : "Settings"} icon={Settings} active={activeView === "settings"} onClick={() => go("settings")} />{isAdmin && <MenuItem label={th ? "จัดการผู้ใช้" : "User Management"} icon={UsersRound} active={activeView === "admin"} onClick={() => go("admin")} />}<MenuItem label={th ? "ออกจากระบบ" : "Logout"} icon={LogOut} onClick={() => { setSheet(null); void onLogout(); }} /></MobileSheetPanel>}
  </>;
}

export default function AppNavigationV2(props: Props) {
  return <><DesktopNavigation {...props} /><MobileNavigation {...props} /></>;
}
