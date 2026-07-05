import * as React from "react";
import type { SuggestionEntry } from "../../lib/types";
import { Card } from "./Card";
import { Button } from "./Button";
import { StatusBadge } from "./StatusBadge";
import { ConfidenceMeter } from "./ConfidenceMeter";

export interface SuggestionCardProps {
  suggestion: SuggestionEntry;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onNudge?: (id: string, delta: -1 | 1) => void;
}

export function SuggestionCard({ suggestion: s, onConfirm, onReject, onNudge }: SuggestionCardProps) {
  return (
    <Card variant="pending" entering className="overflow-hidden">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate font-serif text-md font-semibold text-text-1">{s.reference}</span>
          {s.translation && <span className="font-sans text-xs tracking-caps text-text-3">{s.translation}</span>}
          {(s.repeatCount ?? 0) > 1 && <span className="font-mono text-xs text-pending">×{s.repeatCount}</span>}
          {onNudge && (
            <span className="inline-flex gap-0.5">
              <button onClick={() => onNudge(s.id, -1)} title="Range −1 verse" className="h-5 w-5 rounded border border-border-2 text-[11px] leading-none text-text-2">−</button>
              <button onClick={() => onNudge(s.id, 1)} title="Range +1 verse" className="h-5 w-5 rounded border border-border-2 text-[11px] leading-none text-text-2">+</button>
            </span>
          )}
          {s.stale && <StatusBadge status="offline" label="Stale" />}
        </div>
        <p className="line-clamp-2 whitespace-pre-line font-serif text-base leading-normal text-text-2">{s.text}</p>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {s.confidence != null && <ConfidenceMeter value={s.confidence} />}
        <div className="flex gap-2">
          <Button variant="reject" size="sm" className="flex-1" onClick={() => onReject(s.id)}>Reject</Button>
          <Button variant="approve" size="sm" className="flex-1" onClick={() => onConfirm(s.id)}>Confirm</Button>
        </div>
      </div>
    </Card>
  );
}
