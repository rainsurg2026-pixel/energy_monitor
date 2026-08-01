import { clampRatio } from "../utils/rackCapacity";

interface RackStatusBarProps {
  /** 0-1 fraction, or null when the denominator is zero/unknown - rendered
   *  as an empty track rather than guessed. Always clamped to [0, 1] here
   *  so a data anomaly can never overflow the track. */
  ratio: number | null;
  colorHex: string;
  className?: string;
}

/** A real, DOM-rendered data bar (never ASCII) shared by the Rack Status
 *  Distribution legend and the Rack Zone table. Purely decorative - the
 *  count/percentage text next to it is the accessible value, so this stays
 *  out of the accessibility tree and never intercepts pointer/keyboard
 *  events, which keeps it safe to nest inside a clickable drilldown cell. */
export default function RackStatusBar({ ratio, colorHex, className = "" }: RackStatusBarProps) {
  const clamped = clampRatio(ratio);
  return (
    <div aria-hidden="true" data-testid="rack-status-bar" className={`pointer-events-none h-1.5 w-full overflow-hidden rounded-full bg-slate-800 ${className}`}>
      <div className="h-full rounded-full" style={{ width: `${clamped * 100}%`, background: colorHex }} />
    </div>
  );
}
