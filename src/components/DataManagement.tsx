import React, { useRef, useState } from "react";
import { Download, Upload, Trash2, Database, Sparkles, Check, AlertTriangle } from "lucide-react";
import { loadAllLogs, initializeSampleData, saveLogForMonth } from "../utils";
import { MonthlyLog } from "../types";

interface DataManagementProps {
  onDataChange: () => void;
}

export default function DataManagement({ onDataChange }: DataManagementProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const showStatus = (msg: string, type: "success" | "error") => {
    setStatusMessage(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 4000);
  };

  const handleExport = () => {
    try {
      const allLogs = loadAllLogs();
      if (allLogs.length === 0) {
        showStatus("There is no logging data to export.", "error");
        return;
      }
      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allLogs, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      downloadAnchor.setAttribute("download", `facility_power_logs_${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      showStatus("Facility records exported successfully!", "success");
    } catch (e) {
      showStatus("Failed to export data.", "error");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string) as MonthlyLog[];
        if (!Array.isArray(json)) {
          throw new Error("Invalid format. Expected a JSON array of monthly logs.");
        }

        // Validate basic properties
        let importedCount = 0;
        json.forEach((log) => {
          if (log.month && (log.ups || log.air || log.dc || log.energyCost)) {
            saveLogForMonth(log.month, log);
            importedCount++;
          }
        });

        if (importedCount > 0) {
          showStatus(`Successfully imported ${importedCount} monthly records!`, "success");
          onDataChange();
        } else {
          showStatus("No valid monthly logging records found in file.", "error");
        }
      } catch (err) {
        showStatus("Failed to parse JSON file. Ensure format is correct.", "error");
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (e.target) e.target.value = "";
  };

  const handleLoadSamples = () => {
    initializeSampleData();
    onDataChange();
    showStatus("Sample facility data loaded successfully!", "success");
  };

  const handleClearAll = () => {
    // Clear keys starting with our storage prefix
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("facility_monthly_logs_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    
    setShowConfirmClear(false);
    onDataChange();
    showStatus("All facility database logs cleared.", "success");
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-400" />
          <span>Local Database & Backup Management</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Securely manage your data. All records remain encrypted & local to your browser session. Export/Import anytime to backup or sync files.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Export */}
        <button
          onClick={handleExport}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-xs text-slate-200 font-semibold rounded-xl border border-slate-750 transition-all cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-indigo-400" />
          <span>Export Backup (.JSON)</span>
        </button>

        {/* Import */}
        <button
          onClick={handleImportClick}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-xs text-slate-200 font-semibold rounded-xl border border-slate-750 transition-all cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-teal-400" />
          <span>Import Backup File</span>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImportFile}
          accept=".json"
          className="hidden"
        />

        {/* Load samples */}
        <button
          onClick={handleLoadSamples}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800/50 hover:bg-slate-800 active:bg-slate-750 text-xs text-indigo-400 font-semibold rounded-xl border border-indigo-950/40 hover:border-indigo-900/50 transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span>Load Realistic Samples</span>
        </button>

        {/* Clear */}
        {!showConfirmClear ? (
          <button
            onClick={() => setShowConfirmClear(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-950/10 hover:bg-rose-950/20 text-xs text-rose-400 font-semibold rounded-xl border border-rose-950/20 hover:border-rose-950/35 transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Clear Local Database</span>
          </button>
        ) : (
          <div className="flex gap-1.5 col-span-1">
            <button
              onClick={handleClearAll}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-[10px] text-white font-bold rounded-xl transition-all cursor-pointer"
            >
              <Check className="w-3 h-3" />
              <span>Confirm Wipe</span>
            </button>
            <button
              onClick={() => setShowConfirmClear(false)}
              className="flex-1 px-3 py-2 bg-slate-850 hover:bg-slate-800 text-[10px] text-slate-400 font-semibold rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {statusMessage && (
        <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 font-mono ${
          statusType === "success" 
            ? "bg-emerald-950/20 border-emerald-900/30 text-emerald-400" 
            : "bg-rose-950/20 border-rose-900/30 text-rose-400"
        }`}>
          {statusType === "success" ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}
