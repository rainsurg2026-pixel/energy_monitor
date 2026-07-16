import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Minimal app-wide toast system (desktop replaces window.alert with this).
 * Fire-and-forget: notify("success", "Saved") from anywhere; <ToastHost/> is
 * mounted once in App.
 */

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

type Listener = (toast: ToastItem) => void;

let nextId = 1;
const listeners = new Set<Listener>();

export function notify(type: ToastType, message: string): void {
  const toast: ToastItem = { id: nextId++, type, message };
  listeners.forEach(l => l(toast));
}

const TOAST_STYLES: Record<ToastType, { box: string; icon: React.ReactNode }> = {
  success: {
    box: "bg-emerald-950/90 border-emerald-800/60 text-emerald-200",
    icon: <Check className="w-4 h-4 text-emerald-400 shrink-0" />
  },
  error: {
    box: "bg-rose-950/90 border-rose-800/60 text-rose-200",
    icon: <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
  },
  info: {
    box: "bg-slate-900/95 border-slate-700/60 text-slate-200",
    icon: <Info className="w-4 h-4 text-indigo-400 shrink-0" />
  }
};

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = toast => {
      setToasts(prev => [...prev.slice(-4), toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.type === "error" ? 8000 : 4500);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => {
          const style = TOAST_STYLES[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-sm text-xs font-medium ${style.box}`}
            >
              {style.icon}
              <span className="leading-relaxed whitespace-pre-line flex-1">{toast.message}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="text-slate-500 hover:text-slate-300 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
