import * as React from "react";
import type { OverlayMessage } from "../../lib/types";
import { StatusBadge } from "./StatusBadge";

export interface FeedItemProps {
  entry: OverlayMessage;
  /** True for the verse currently on the projector. */
  current?: boolean;
  /** Re-displays this reference live. Omitted (or disabled) when the viewer can't act. */
  onRedisplay?: () => void;
  disabled?: boolean;
}

export function FeedItem({ entry, current, onRedisplay, disabled }: FeedItemProps) {
  const clickable = Boolean(onRedisplay) && !current && !disabled;
  return (
    <button
      type="button"
      onClick={onRedisplay}
      disabled={!clickable}
      title={clickable ? "Show this verse again" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-sm border px-3 py-2 text-left font-sans ${current ? "border-gold-dim bg-gold-wash" : "border-transparent"} ${clickable ? "cursor-pointer hover:bg-bg-1" : "cursor-default"}`}
    >
      <span className={`flex-1 truncate font-serif text-base font-semibold ${current ? "text-gold-bright" : "text-text-1"}`}>
        {entry.reference}
      </span>
      {current
        ? <StatusBadge status="live" label="On screen" />
        : <StatusBadge status="offline" label="Shown" />}
    </button>
  );
}
