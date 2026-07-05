import * as React from "react";
import type { ListeningState } from "../../lib/design-types";

const STATES: Record<ListeningState, { dot: string; label: string; pulse: boolean }> = {
  listening: { dot: "bg-live shadow-[0_0_12px_var(--live)]", label: "Listening", pulse: true },
  idle: { dot: "bg-info", label: "Not listening", pulse: false },
  connecting: { dot: "bg-pending", label: "Connecting…", pulse: true },
  error: { dot: "bg-danger", label: "Connection lost", pulse: false },
};

export interface LiveIndicatorProps {
  state: ListeningState;
  /** Mono sub-line, e.g. "Shure MV7 · John 3". */
  detail?: string;
  className?: string;
}

export function LiveIndicator({ state, detail, className = "" }: LiveIndicatorProps) {
  const s = STATES[state];
  return (
    <div className={`flex items-center gap-2.5 font-sans ${className}`}>
      <span className={`h-2.5 w-2.5 flex-none rounded-pill ${s.dot} ${s.pulse ? "animate-pulse-dot" : ""}`} />
      <div className="flex flex-col">
        <span className="text-base font-semibold leading-tight text-text-1">{s.label}</span>
        {detail && <span className="font-mono text-xs text-text-3">{detail}</span>}
      </div>
    </div>
  );
}
