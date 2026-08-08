import { useMemo, useState } from "react";
import type { RackCapacitySummary, RackRecord } from "../../reports/reportTypes";
import type { IDataProvider, RackFieldChangeRequest } from "../../data/IDataProvider";
import type { RackCapacityHistoryRow } from "../../excel/RackCapacityHistoryWriter";
import { RACK_CANONICAL_STATUSES } from "../../utils/rackCapacity";
import { notify } from "../Toast";
import { Search, X, Save, AlertTriangle, Camera } from "lucide-react";
import { useRackCapacity } from "./RackCapacityContext";
import { rackStatusLabel } from "../../utils/rackStatusConfig";
import { RACK_CAPACITY_EDITOR_ANCHOR_ID } from "./ZoneHeatmap";
import { monthLabelLong } from "../../utils/monthUtils";

interface StagedFieldEdit {
  expected: string | null;
  next: string | null;
}

type TextEditableField = "cabinetSize" | "detail" | "deviceType" | "remarks";

interface StagedChange {
  rackId: string;
  rackZone: string | null;
  status?: { expected: string | null; next: string };
  cabinetSize?: StagedFieldEdit;
  detail?: StagedFieldEdit;
  deviceType?: StagedFieldEdit;
  remarks?: StagedFieldEdit;
}

function hasAnyStagedField(change: StagedChange): boolean {
  return Boolean(change.status || change.cabinetSize || change.detail || change.deviceType || change.remarks);
}
// duplicate imports removed

export default function RackCapacityEditor({ provider, onSaved }: { provider: IDataProvider; onSaved?: (updated: RackCapacitySummary, history: RackCapacityHistoryRow[]) => void }) {
  const { lang, reportingMonth: month, rackCapacity, selectedZone, setSelectedZone } = useRackCapacity();
  const zoneFilter = selectedZone ?? "";
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [idQuery, setIdQuery] = useState<string>("");
  const [staged, setStaged] = useState<Map<number, StagedChange>>(new Map());
  const [saving, setSaving] = useState(false);

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
    setSelectedZone(null);
    setStatusFilter("");
    setIdQuery("");
  };

  const statusLabel = (status: string): string => rackStatusLabel(status, lang);

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
        if (change.remarks) request.remarks = change.remarks;
        return request;
      });
      const result = await provider.saveRackCapacity(changes, month);
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
      onSaved?.(result.rackCapacity, result.rackCapacityHistory);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const [snapshotting, setSnapshotting] = useState(false);

  /** Records a Rack Capacity History snapshot for the Reporting Month using
   *  the CURRENT live data, even with zero staged field changes - a
   *  deliberate, separate action from Save Changes (which never writes a
   *  no-op to the backup history). */
  const createSnapshot = async () => {
    if (!provider.saveRackCapacity) return;
    setSnapshotting(true);
    try {
      const result = await provider.saveRackCapacity([], month, true);
      notify("success", lang === "th" ? `บันทึกสแนปช็อตประจำเดือน ${monthLabelLong(month, lang)} แล้ว` : `Recorded a monthly snapshot for ${monthLabelLong(month, lang)}.`);
      onSaved?.(result.rackCapacity, result.rackCapacityHistory);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotting(false);
    }
  };

  if (!rackCapacity) {
    return (
      <section id={RACK_CAPACITY_EDITOR_ANCHOR_ID} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          {lang === "th" ? "ไม่พบข้อมูลความจุแร็คในเวิร์กบุ๊กปัจจุบัน" : "Rack capacity data is unavailable in the current workbook."}
        </p>
      </section>
    );
  }

  return (
    <section id={RACK_CAPACITY_EDITOR_ANCHOR_ID} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base text-slate-100">{lang === "th" ? "แก้ไขความจุแร็ค" : "Rack Capacity Editor"}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {lang === "th" ? "ค้นหาแร็คและแก้ไขสถานะ ขนาดตู้ รายละเอียด ประเภทอุปกรณ์ หรือหมายเหตุ การเปลี่ยนแปลงจะยังไม่บันทึกจนกว่าจะกดบันทึก" : "Find a rack and edit its status, cabinet size, detail, device type, or remarks. Changes are staged until you save."}
          </p>
        </div>
        {hasPendingWork && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {lang === "th" ? `การเปลี่ยนแปลงที่ยังไม่บันทึก ${staged.size} รายการ` : `${staged.size} unsaved change${staged.size === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "โซนแร็ค" : "Rack Zone"}</label>
          <select value={zoneFilter} onChange={e => setSelectedZone(e.target.value === "" ? null : e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">
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
          <button
            type="button"
            onClick={() => void createSnapshot()}
            disabled={snapshotting || saving}
            title={lang === "th" ? "บันทึกสแนปช็อตประวัติของเดือนนี้ด้วยข้อมูลปัจจุบัน แม้ไม่มีการแก้ไข" : "Record this month's history snapshot from the current data, even with no edits"}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />{snapshotting ? (lang === "th" ? "กำลังบันทึก…" : "Recording…") : (lang === "th" ? "บันทึกสแนปช็อตประจำเดือน" : "Record Monthly Snapshot")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem]">
          <table className="w-full min-w-[980px] text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-950/95">
              <tr className="text-left">
                <th className="py-3 px-4">{lang === "th" ? "โซน" : "Zone"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รหัสแร็ค" : "Rack ID"}</th>
                <th className="py-3 px-4">{lang === "th" ? "สถานะ" : "Status"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ขนาดตู้" : "Cabinet Size"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รายละเอียด" : "Detail"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ประเภทอุปกรณ์" : "Device Type"}</th>
                <th className="py-3 px-4">{lang === "th" ? "หมายเหตุ" : "Remarks"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 && (
                <tr><td colSpan={7} className="py-8 px-4 text-center text-slate-500">
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
                    <td className="py-2 px-4">
                      <input
                        type="text"
                        value={fieldDisplayValue(record, pending, "remarks")}
                        onChange={e => stageTextField(record, "remarks", e.target.value)}
                        placeholder="—"
                        className={textFieldClass(Boolean(pending?.remarks))}
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
