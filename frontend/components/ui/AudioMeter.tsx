import * as React from "react";

export interface AudioMeterProps {
  /** 0–1 current input level. */
  level: number;
  active?: boolean;
  bars?: number;
}

/** Mic input meter — answers "is it hearing anything?" at a glance. */
export function AudioMeter({ level, active = true, bars = 12 }: AudioMeterProps) {
  return (
    <div className="flex h-4 items-center gap-0.5" title={active ? "Input level" : "No input"}>
      {Array.from({ length: bars }).map((_, i) => {
        const on = active && level * bars > i;
        const hot = i >= bars - 2;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] transition-colors duration-75 ${on ? (hot ? "bg-pending" : "bg-live") : "bg-border-2"}`}
            style={{ height: `${6 + (i / bars) * 10}px` }}
          />
        );
      })}
    </div>
  );
}
