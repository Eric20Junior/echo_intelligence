import * as React from "react";

export interface ConfidenceMeterProps {
  /** 0–1 */
  value: number;
  className?: string;
}

export function ConfidenceMeter({ value, className = "" }: ConfidenceMeterProps) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? "bg-live" : value >= 0.6 ? "bg-pending" : "bg-danger";
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="h-1 w-11 flex-none overflow-hidden rounded-full bg-bg-1">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-sm text-text-2">{pct}%</span>
    </span>
  );
}
