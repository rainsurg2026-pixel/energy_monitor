import { AlertTriangle, CircleAlert, Eye, Loader2, SearchX } from "lucide-react";

type ViewStateKind = "loading" | "empty" | "partial" | "error" | "readonly";

const presentation = {
  loading: { Icon: Loader2, icon: "text-blue-400", border: "border-blue-500/25", bg: "bg-blue-500/5" },
  empty: { Icon: SearchX, icon: "text-slate-400", border: "border-slate-700", bg: "bg-slate-900" },
  partial: { Icon: AlertTriangle, icon: "text-amber-400", border: "border-amber-500/25", bg: "bg-amber-500/5" },
  error: { Icon: CircleAlert, icon: "text-rose-400", border: "border-rose-500/30", bg: "bg-rose-500/5" },
  readonly: { Icon: Eye, icon: "text-teal-400", border: "border-teal-500/25", bg: "bg-teal-500/5" },
} as const;

interface Props {
  kind: ViewStateKind;
  title: string;
  detail?: string | null;
  compact?: boolean;
  action?: { label: string; onClick: () => void };
}

export default function ViewStatePanel({ kind, title, detail, compact = false, action }: Props) {
  const state = presentation[kind];
  const Icon = state.Icon;
  return <section role={kind === "error" ? "alert" : "status"} data-view-state={kind} className={`rounded-2xl border text-center ${state.border} ${state.bg} ${compact ? "p-4" : "p-8"}`}>
    <Icon className={`mx-auto ${compact ? "h-5 w-5" : "h-8 w-8"} ${state.icon} ${kind === "loading" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
    <h3 className={`${compact ? "mt-2 text-sm" : "mt-3 text-base"} font-display font-bold text-slate-200`}>{title}</h3>
    {detail && <p className={`mx-auto mt-1.5 max-w-xl leading-relaxed text-slate-500 ${compact ? "text-xs" : "text-sm"}`}>{detail}</p>}
    {action && <button type="button" onClick={action.onClick} className="mt-4 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500">{action.label}</button>}
  </section>;
}
