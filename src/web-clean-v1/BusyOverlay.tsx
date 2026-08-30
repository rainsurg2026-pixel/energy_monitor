import { Loader2 } from "lucide-react";

type BusyOverlayProps = {
  title: string;
  detail?: string | null;
  progress?: number | null;
  progressLabel?: string | null;
};

export default function BusyOverlay({ title, detail, progress = null, progressLabel }: BusyOverlayProps) {
  const hasProgress = Number.isFinite(progress);
  const normalizedProgress = hasProgress ? Math.min(100, Math.max(0, Number(progress))) : null;
  const roundedProgress = normalizedProgress === null ? null : Math.round(normalizedProgress);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 px-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
      data-testid="busy-overlay"
    >      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900/95 p-7 text-center shadow-2xl">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sky-500/10">
          <Loader2 className="h-14 w-14 animate-spin text-sky-400 motion-reduce:animate-none" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-xl font-bold tracking-tight text-slate-100">{title}</h2>
        {detail && <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">{detail}</p>}

        <div className="mt-6" aria-label={progressLabel ?? "Progress"}>
          <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-400">
            <span>{progressLabel ?? "Working"}</span>
            {roundedProgress !== null && <span className="font-mono text-sm text-sky-300">{roundedProgress}%</span>}
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800" role={roundedProgress !== null ? "progressbar" : undefined} aria-valuemin={roundedProgress !== null ? 0 : undefined} aria-valuemax={roundedProgress !== null ? 100 : undefined} aria-valuenow={roundedProgress ?? undefined}>
            {normalizedProgress !== null ? (
              <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${normalizedProgress}%` }} />
            ) : (
              <div className="busy-overlay-indeterminate h-full w-2/5 rounded-full bg-sky-500 motion-reduce:w-full" />
            )}
          </div>
        </div>        <p className="mt-4 text-xs font-medium text-slate-500">Please wait. Do not close this window.</p>
      </section>
      <style>{`
        @keyframes busy-overlay-progress {
          0% { transform: translateX(-125%); }
          100% { transform: translateX(250%); }
        }
        .busy-overlay-indeterminate { animation: busy-overlay-progress 1.15s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .busy-overlay-indeterminate { animation: none; transform: none; }
        }
      `}</style>
    </div>
  );
}
