import * as React from "react";

type Variant = "primary" | "neutral" | "ghost" | "approve" | "reject" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gold text-inverse hover:bg-gold-bright border-transparent",
  neutral: "bg-bg-3 text-text-1 border-border-2 hover:bg-border-2",
  ghost: "bg-transparent text-text-2 border-transparent hover:bg-bg-3",
  approve: "bg-live-wash text-live border-live hover:bg-live hover:text-inverse",
  reject: "bg-danger-wash text-danger border-danger hover:bg-danger hover:text-inverse",
  danger: "bg-danger text-inverse border-transparent hover:brightness-110",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  /** Keyboard shortcut chip rendered inside the button, e.g. "Enter". */
  keyHint?: string;
  icon?: React.ReactNode;
}

export function Button({ variant = "neutral", size = "md", keyHint, icon, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-sans text-base font-semibold",
        "transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-control px-3" : "h-control-lg px-4",
        VARIANTS[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {icon}
      {children}
      {keyHint && (
        <span className="rounded border border-current px-1 py-px font-mono text-[10px] leading-tight opacity-60">{keyHint}</span>
      )}
    </button>
  );
}
