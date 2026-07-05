import * as React from "react";

const VARIANTS = {
  default: "bg-bg-2 border-border-1",
  pending: "bg-pending-wash border-pending",
  live: "bg-live-wash border-live",
} as const;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof VARIANTS;
  /** Play the enter animation (new item arriving over the socket). */
  entering?: boolean;
  /** Play the exit animation; remove from state after it ends (240ms). */
  exiting?: boolean;
}

export function Card({ variant = "default", entering, exiting, className = "", ...rest }: CardProps) {
  return (
    <div
      className={[
        "rounded-md border p-4 shadow-card",
        VARIANTS[variant],
        entering && !exiting ? "animate-card-in" : "",
        exiting ? "animate-card-out" : "",
        className,
      ].join(" ")}
      {...rest}
    />
  );
}
