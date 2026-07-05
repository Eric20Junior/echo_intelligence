import * as React from "react";

export interface VerseDisplayProps {
  reference: string;
  translation?: string;
  text: string;
  /** "centered" (default, full black) or "lower-third" (over a camera feed). */
  layout?: "centered" | "lower-third";
  /** Long-passage pagination (1-based). */
  page?: number;
  pageCount?: number;
  /** Text-size safety control (0.85 / 1 / 1.15 / 1.3). */
  fontScale?: number;
  /** Key on the verse id — remounting replays the 700ms entrance. */
  verseKey?: string | number;
}

/**
 * Projector composition. Place inside a `relative` full-viewport container.
 * The projector route never gets `data-theme="light"`.
 */
export function VerseDisplay({ reference, translation = "KJV", text, layout = "centered", page, pageCount, fontScale = 1, verseKey }: VerseDisplayProps) {
  const centered = layout === "centered";
  const fs = (v: string) => (fontScale === 1 ? v : `calc(${v} * ${fontScale})`);
  return (
    <div
      key={verseKey}
      className={[
        "absolute inset-0 box-border flex flex-col px-projector pt-projector",
        centered ? "items-center justify-center bg-bg-0 pb-projector text-center" : "items-start justify-end pb-[5vh] text-left",
      ].join(" ")}
    >
      {!centered && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55vh] bg-gradient-to-t from-[#0a0908f2] from-30% to-transparent" />
      )}
      <div className={`relative animate-verse-in ${centered ? "max-w-[80vw]" : "max-w-[88vw]"}`}>
        <div className={`flex items-baseline gap-[1.2vw] ${centered ? "justify-center" : "justify-start"}`}>
          <span className="whitespace-nowrap font-serif font-semibold tracking-display text-reference" style={{ fontSize: fs("clamp(44px, 5.6vw, 108px)"), lineHeight: 1.1 }}>{reference}</span>
          <span className="font-sans font-medium tracking-caps text-gold-dim" style={{ fontSize: fs("clamp(16px, 1.3vw, 25px)") }}>{translation}</span>
        </div>
        <div className={`h-0.5 bg-gold-dim opacity-80 ${centered ? "mx-auto my-[3vh] w-[120px]" : "my-[2.5vh] w-[88px]"}`} />
        <p className="font-serif leading-[1.4] text-scripture [text-wrap:pretty]" style={{ fontSize: fs("clamp(30px, 3.4vw, 66px)") }}>{text}</p>
        {pageCount && pageCount > 1 && (
          <div className={`mt-[3.5vh] flex items-center gap-[0.7vw] ${centered ? "justify-center" : "justify-start"}`}>
            {Array.from({ length: pageCount }).map((_, i) => (
              <span key={i} className={`h-[max(0.55vw,7px)] w-[max(0.55vw,7px)] rounded-pill ${i === (page ?? 1) - 1 ? "bg-gold" : "bg-border-2"}`} />
            ))}
            <span className="ml-[0.6vw] font-sans text-[clamp(13px,1vw,19px)] tracking-caps text-text-3">{page} of {pageCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
