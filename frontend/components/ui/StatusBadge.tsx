import * as React from "react";

type Status = "pending" | "live" | "rejected" | "listening" | "offline" | "auto";

const STATES: Record<Status, { cls: string; dot: string; label: string; pulse: boolean }> = {
  pending: { cls: "bg-pending-wash border-pending text-pending", dot: "bg-pending", label: "Pending", pulse: true },
  live: { cls: "bg-live-wash border-live text-live", dot: "bg-live", label: "Live", pulse: false },
  rejected: { cls: "bg-danger-wash border-danger text-danger", dot: "bg-danger", label: "Rejected", pulse: false },
  listening: { cls: "bg-live-wash border-live text-live", dot: "bg-live", label: "Listening", pulse: true },
  offline: { cls: "bg-info-wash border-info text-info", dot: "bg-info", label: "Offline", pulse: false },
  auto: { cls: "bg-gold-wash border-gold text-gold", dot: "bg-gold", label: "Auto", pulse: false },
};

export interface StatusBadgeProps {
  status?: Status;
  label?: string;
  className?: string;
}

export function StatusBadge({ status = "pending", label, className = "" }: StatusBadgeProps) {
  const s = STATES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 font-sans text-xs font-semibold uppercase tracking-caps ${s.cls} ${className}`}>
      <span className={`h-1.5 w-1.5 flex-none rounded-pill ${s.dot} ${s.pulse ? "animate-pulse-dot" : ""}`} />
      {label ?? s.label}
    </span>
  );
}
