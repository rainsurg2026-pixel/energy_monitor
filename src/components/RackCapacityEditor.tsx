import { useMemo, useState } from "react";
import type { RackCapacitySummary, RackRecord } from "../reports/reportTypes";
import type { IDataProvider, RackFieldChangeRequest } from "../data/IDataProvider";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import { RACK_CANONICAL_STATUSES } from "../utils/rackCapacity";
import { notify } from "./Toast";
import { Search, X, Save, AlertTriangle } from "lucide-react";

interface RackCapacityEditorProps {
  rackCapacity: RackCapacitySummary | null;
  provider: IDataProvider;
  lang: "th" | "en";
  /** Canonical "YYYY-MM" - shared with the Rack Unit Capacity panel's own
   *  Month/Year selector. Controls which month's Rack Capacity History
   *  snapshot this save upserts; an explicit, user-visible choice, never a
   *  silent system-month assumption. Table7 itself has no month dimension -
   *  Status/Cabinet Size/Detail/Device Type are always CURRENT state. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Called with the freshly-saved snapshot (+ history) so the parent can
   *  refresh its own copy without a full workbook reload. */
  onSaved: (rackCapacity: RackCapacitySummary | null, rackCapacityHistory: RackCapacityHistoryRow[]) => void;
}

interface StagedFieldEdit {
  expected: string | null;
  next: string | null;
}

type TextEditableField = "cabinetSize" | "detail" | "deviceType";

interface StagedChange {
  rackId: string;
  rackZone: string | null;
  status?: { expected: string | null; next: string };
  cabinetSize?: StagedFieldEdit;
  detail?: StagedFieldEdit;
  deviceType?: StagedFieldEdit;
}

function hasAnyStagedField(change: StagedChange): boolean {
  return Boolean(change.status || change.cabinetSize || change.detail || change.deviceType);
}

const STATUS_LABEL_TH: Record<string, string> = {
  "In Use": "ใช้งานอยู่",
  "Available": "ว่าง",
  "Reserved": "จองไว้",
  "Pending Dismantle": "รอถอดถอน"
};

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

export default function RackCapacityEditor({ rackCapacity, provider, lang, month, onMonthChange, onSaved }: RackCapacityEditorProps) {
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [idQuery, setIdQuery] = useState<string>("");
  const [staged, setStaged] = useState<Map<number, StagedChange>>(new Map());
  const [saving, setSaving] = useState(false);

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const monthNames = lang === "th" ? MONTH_NAMES_TH : MONTH_NAMES_EN;

  const records = rackCapacity?.records ?? [];

  const zoneOptions = useMemo(
    () => Array.from(new Set(records.map(r => r.rackZone).filter((z): z is string => Boolean(z)))).sort((a, b) => a.localeCompare(b)),
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = idQuery.trim().toLowerCase();
    return records.filter(record => {
      if (zoneFilter && (record.rackZone ?? "") !== zoneFilter) return false;
      if (statusFilter && (record.status ?? "") !== statusFilter) return false;
      if (query && !(record.rackId ?? "").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [records, zoneFilter, statusFilter, idQuery]);

  const hasFilters = Boolean(zoneFilter || statusFilter || idQuery);
  const clearFilters = () => {
    setZoneFilter("");
    setStatusFilter("");
    setIdQuery("");
  };

  const statusLabel = (status: string): string => (lang === "th" ? STATUS_LABEL_TH[status] ?? status : status);

  const stageStatus = (record: RackRecord, newStatus: string) => {
    setStaged((prev: Map<number, StagedChange>) => {
      const next = new Map(prev);
      const existing: StagedChange | undefined = next.get(record.rowNumber);
      const updated: StagedChange = existing !== undefined
        ? { ...existing }
        : { rackId: record.rackId ?? "", rackZone: record.rackZone };
      if (newStatus === (record.status ?? "")) {
        delete updated.status;
      } else {
        updated.status = { expected: record.status, next: newStatus };
      }
      if (hasAnyStagedField(updated)) next.set(record.rowNumber, updated);
      else next.delete(record.rowNumber);
      return next;
    });
  };

  const stageTextField = (record: RackRecord, field: TextEditableField, rawValue: string) => {
    setStaged((prev: Map<number, StagedChange>) => {
      const next = new Map(prev);
      const existing: StagedChange | undefined = next.get(record.rowNumber);
      const updated: StagedChange = existing !== undefined
        ? { ...existing }
        : { rackId: record.rackId ?? "", rackZone: record.rackZone };
      const nextValue = rawValue === "" ? null : rawValue;
      const originalValue = record[field];
      if (nextValue === originalValue) {
        delete updated[field];
      } else {
        updated[field] = { expected: originalValue, next: nextValue };
      }
      if (hasAnyStagedField(updated)) next.set(record.rowNumber, updated);
      else next.delete(record.rowNumber);
      return next;
    });
  };

  const fieldDisplayValue = (record: RackRecord, pending: StagedChange | undefined, field: TextEditableField): string => {
    const edit = pending?.[field];
    if (edit) return edit.next ?? "";
    return record[field] ?? "";
  };

  const discardChanges = () => setStaged(new Map());

  const hasPendingWork = staged.size > 0;

  const saveChanges = async () => {
    if (!hasPendingWork || !provider.saveRackCapacity) return;
    setSaving(true);
    try {
      const changes: RackFieldChangeRequest[] = Array.from(staged.entries()).map(([rowNumber, change]) => {
        const request: RackFieldChangeRequest = { rowNumber, rackId: change.rackId };
        if (change.status) request.status = change.status;
        if (change.cabinetSize) request.cabinetSize = change.cabinetSize;
        if (change.detail) request.detail = change.detail;
        if (change.deviceType) request.deviceType = change.deviceType;
        return request;
      });
      const result = await provider.saveRackCapacity(changes, null, month);
      const conflicts = result.outcomes.filter(o => !o.applied);
      if (conflicts.length === 0) {
        notify("success", result.changedCount > 0
          ? (lang === "th" ? `บันทึกการเปลี่ยนแปลง ${result.changedCount} รายการแล้ว` : `Saved ${result.changedCount} field change${result.changedCount === 1 ? "" : "s"}.`)
          : (lang === "th" ? "ไม่มีการเปลี่ยนแปลง" : "Nothing to save."));
        setStaged(new Map());
      } else {
        // Keep only the still-conflicting rows staged; applied ones are done.
        setStaged(prev => {
          const next = new Map(prev);
          for (const outcome of result.outcomes) if (outcome.applied) next.delete(outcome.rowNumber);
          return next;
        });
        notify("error", lang === "th"
          ? `${conflicts.length} รายการมีการเปลี่ยนแปลงจากที่อื่นแล้ว กรุณาโหลดใหม่และลองอีกครั้ง`
          : `${conflicts.length} change${conflicts.length === 1 ? "" : "s"} conflicted with a newer value on disk - reload and retry those rows.`);
      }
      onSaved(result.rackCapacity, result.rackCapacityHistory);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!rackCapacity) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          {lang === "th" ? "ไม่พบข้อมูลความจุแร็คในเวิร์กบุ๊กปัจจุบัน" : "Rack capacity data is unavailable in the current workbook."}
        </p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base text-slate-100">{lang === "th" ? "แก้ไขความจุแร็ค" : "Rack Capacity Editor"}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {lang === "th" ? "ค้นหาแร็คและแก้ไขสถานะ ขนาดตู้ รายละเอียด หรือประเภทอุปกรณ์ การเปลี่ยนแปลงจะยังไม่บันทึกจนกว่าจะกดบันทึก" : "Find a rack and edit its status, cabinet size, detail, or device type. Changes are staged until you save."}
          </p>
        </div>
        {hasPendingWork && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {lang === "th" ? `การเปลี่ยนแปลงที่ยังไม่บันทึก ${staged.size} รายการ` : `${staged.size} unsaved change${staged.size === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs text-slate-400 mb-2">
          {lang === "th" ? "เดือนของสแนปช็อตประวัติ (บันทึกร่วมกับความจุหน่วยแร็คด้านบน)" : "History snapshot month (shared with Rack Unit Capacity above)"}
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-sm">
          <select
            value={monthNum}
            onChange={e => onMonthChange(`${year}-${String(Number(e.target.value)).padStart(2, "0")}`)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {monthNames.map((name, idx) => <option key={name} value={idx + 1}>{name}</option>)}
          </select>
          <select
            value={year}
            onChange={e => onMonthChange(`${e.target.value}-${String(monthNum).padStart(2, "0")}`)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "โซนแร็ค" : "Rack Zone"}</label>
          <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">{lang === "th" ? "ทุกโซน" : "All zones"}</option>
            {zoneOptions.map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "รหัสแร็ค" : "Rack ID"}</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={idQuery}
              onChange={e => setIdQuery(e.target.value)}
              placeholder={lang === "th" ? "ค้นหา เช่น AA01" : "Search, e.g. AA01"}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "สถานะ" : "Status"}</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">{lang === "th" ? "ทุกสถานะ" : "All statuses"}</option>
            {RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500">
          {lang === "th" ? `พบ ${filteredRecords.length} จากทั้งหมด ${records.length} แร็ค` : `${filteredRecords.length} of ${records.length} racks`}
        </p>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />{lang === "th" ? "ล้างตัวกรอง" : "Clear Filters"}
            </button>
          )}
          {hasPendingWork && (
            <button
              type="button"
              onClick={discardChanges}
              disabled={saving}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              {lang === "th" ? "ยกเลิกการเปลี่ยนแปลง" : "Discard changes"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveChanges()}
            disabled={!hasPendingWork || saving}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />{saving ? (lang === "th" ? "กำลังบันทึก…" : "Saving…") : (lang === "th" ? "บันทึกการเปลี่ยนแปลง" : "Save Changes")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem]">
          <table className="w-full min-w-[820px] text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-950/95">
              <tr className="text-left">
                <th className="py-3 px-4">{lang === "th" ? "โซน" : "Zone"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รหัสแร็ค" : "Rack ID"}</th>
                <th className="py-3 px-4">{lang === "th" ? "สถานะ" : "Status"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ขนาดตู้" : "Cabinet Size"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รายละเอียด" : "Detail"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ประเภทอุปกรณ์" : "Device Type"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 && (
                <tr><td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                  {lang === "th" ? "ไม่พบแร็คที่ตรงกับตัวกรอง" : "No racks match the current filters."}
                </td></tr>
              )}
              {filteredRecords.map(record => {
                const pending = staged.get(record.rowNumber);
                const currentValue = pending?.status ? pending.status.next : (record.status ?? "");
                const textFieldClass = (dirty: boolean) =>
                  `w-full bg-slate-950 border rounded-md px-2 py-1 text-xs placeholder:text-slate-600 ${dirty ? "border-amber-400/60 text-amber-300" : "border-slate-800 text-slate-200"}`;
                return (
                  <tr key={`${record.rowNumber}-${record.rackId ?? "blank"}`} className={`border-t border-slate-800 ${pending ? "bg-amber-400/5" : ""}`}>
                    <td className="py-2 px-4">{record.rackZone ?? "—"}</td>
                    <td className="py-2 px-4 font-mono">{record.rackId ?? "—"}</td>
                    <td className="py-2 px-4">
                      <select
                        value={currentValue}
                        onChange={e => stageStatus(record, e.target.value)}
                        className={`bg-slate-950 border rounded-md px-2 py-1 text-xs ${pending?.status ? "border-amber-400/60 text-amber-300" : "border-slate-800 text-slate-200"}`}
                      >
                        {!RACK_CANONICAL_STATUSES.includes(currentValue as (typeof RACK_CANONICAL_STATUSES)[number]) && currentValue && (
                          <option value={currentValue}>{currentValue}</option>
                        )}
                        {RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={fieldDisplayValue(record, pending, "cabinetSize")}
                        onChange={e => stageTextField(record, "cabinetSize", e.target.value)}
                        placeholder="—"
                        className={textFieldClass(Boolean(pending?.cabinetSize))}
                      />
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={fieldDisplayValue(record, pending, "detail")}
                        onChange={e => stageTextField(record, "detail", e.target.value)}
                        placeholder="—"
                        className={textFieldClass(Boolean(pending?.detail))}
                      />
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={fieldDisplayValue(record, pending, "deviceType")}
                        onChange={e => stageTextField(record, "deviceType", e.target.value)}
                        placeholder="—"
                        className={textFieldClass(Boolean(pending?.deviceType))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
