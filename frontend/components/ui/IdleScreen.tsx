import * as React from "react";

/** Projector idle state — faint wordmark, never a dead black screen. */
export function IdleScreen() {
  return (
    <div className="absolute inset-0 flex animate-verse-in items-center justify-center bg-bg-0">
      <div className="flex items-baseline gap-[0.6vw] opacity-20">
        <span className="font-serif text-[clamp(28px,2.6vw,52px)] font-semibold text-gold">Echo</span>
        <span className="text-[clamp(28px,2.6vw,52px)] font-normal text-text-2">Intelligence</span>
      </div>
    </div>
  );
}
