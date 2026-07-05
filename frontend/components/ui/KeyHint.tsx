import * as React from "react";

export interface KeyHintProps {
  keys: string | string[];
  className?: string;
}

export function KeyHint({ keys, className = "" }: KeyHintProps) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {list.map((k) => (
        <kbd key={k} className="rounded border border-b-2 border-border-2 bg-bg-1 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-text-2">
          {k}
        </kbd>
      ))}
    </span>
  );
}
