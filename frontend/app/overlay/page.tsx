"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEchoSocket } from "@/lib/useEchoSocket";
import type { OverlayMessage } from "@/lib/types";

// How long a WS disconnect is allowed to leave the last verse frozen on
// screen before it fades out. Fine to sit frozen indefinitely on a projector
// (one operator, notices and restarts) — reads as "broken software" on a
// livestream corner box with no one watching that layer, so we clear it.
const DISCONNECT_FADE_MS = 3000;

const POSITION_CLASSES: Record<string, string> = {
  center: "inset-0 flex items-center justify-center p-8",
  tl: "top-6 left-6",
  tr: "top-6 right-6",
  bl: "bottom-6 left-6",
  br: "bottom-6 right-6",
};

const SIZE_CLASSES: Record<string, { reference: string; body: string }> = {
  small: { reference: "text-[clamp(14px,1.6vw,22px)]", body: "text-[clamp(12px,1.3vw,18px)]" },
  medium: { reference: "text-[clamp(20px,2.4vw,34px)]", body: "text-[clamp(16px,1.9vw,26px)]" },
  large: { reference: "text-[3vw]", body: "text-[2.2vw]" },
};

function OverlayContent() {
  const params = useSearchParams();
  const transparent = params.get("transparent") === "1";
  const position = POSITION_CLASSES[params.get("position") ?? "center"] ? (params.get("position") ?? "center") : "center";
  const size = SIZE_CLASSES[params.get("size") ?? ""] ? (params.get("size") as string) : transparent ? "medium" : "large";

  const [current, setCurrent] = useState<OverlayMessage | null>(null);
  const [faded, setFaded] = useState(false);
  const [everEnteredFullscreen, setEverEnteredFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Auto-fit: the size classes below set the *maximum* font size, but a long passage
  // (many verses) would grow taller than the screen and clip top/bottom. We measure the
  // text's natural layout size against the viewport and scale it down just enough to fit,
  // never up past the configured size. offsetWidth/offsetHeight are the untransformed
  // layout box, so re-measuring after applying the transform stays stable (no feedback loop).
  const contentRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  // Only auto_display/approved detections ever reach this page — `suggest`
  // status is queued for operator approval instead (see the operator page).
  const { connected } = useEchoSocket<OverlayMessage>("overlay", (msg) => {
    setCurrent((prev) => (prev?.reference === msg.reference && prev?.text === msg.text ? prev : msg));
  });

  useEffect(() => {
    if (connected) {
      setFaded(false);
      return;
    }
    const timer = setTimeout(() => setFaded(true), DISCONNECT_FADE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  useEffect(() => {
    if (!transparent) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, [transparent]);

  useEffect(() => {
    function handleFullscreenChange() {
      const active = document.fullscreenElement != null;
      setIsFullscreen(active);
      if (active) setEverEnteredFullscreen(true);
    }
    function handleVisibilityChange() {
      if (document.hidden) console.warn("overlay page lost visibility/focus");
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function goFullscreen() {
    document.documentElement.requestFullscreen().catch((err) => console.warn("fullscreen request failed:", err.message));
  }

  // Recompute the fit whenever the passage, size, position, or window dimensions change.
  // We compare the content's natural box to the available space and pick the largest
  // scale ≤ 1 that fits both axes, with a small margin so text never kisses the edge.
  // offsetWidth/offsetHeight report the *untransformed* layout box (CSS transforms don't
  // affect them), so they're already the natural size regardless of the scale applied —
  // the measurement is stable and there's no feedback loop. Runs via requestAnimationFrame
  // so the DOM has laid out at the base font size before we measure.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    function measure() {
      const node = contentRef.current;
      if (!node) return;
      // Available space: transparent corner boxes are already width-capped by max-w-[36vw]
      // and wrap their text, so height is the only real overflow axis there — constraining
      // width against a shrink-wrapped parent would force a spurious shrink on short verses.
      // Centered/fullscreen fits both axes against the viewport.
      const margin = 0.94;
      const availH = (transparent ? window.innerHeight * 0.9 : window.innerHeight) * margin;
      const naturalH = node.offsetHeight;
      const naturalW = node.offsetWidth;
      if (naturalH === 0 || naturalW === 0) return;
      const widthRatio = transparent ? 1 : (window.innerWidth * margin) / naturalW;
      const next = Math.min(1, availH / naturalH, widthRatio);
      // Round to avoid churn from sub-pixel jitter re-triggering a state update.
      const rounded = Math.round(next * 1000) / 1000;
      setFitScale((prev) => (Math.abs(prev - rounded) > 0.002 ? rounded : prev));
    }
    raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [current?.reference, current?.text, size, position, transparent]);

  const visible = current != null && !faded;
  const sizeClasses = SIZE_CLASSES[size];

  return (
    <div className={`font-serif text-neutral-100 ${transparent ? `fixed ${POSITION_CLASSES[position]}` : "flex h-screen items-center justify-center bg-black"}`}>
      <div
        ref={contentRef}
        style={{ transform: `scale(${fitScale})`, transformOrigin: "center" }}
        className={`max-w-[80vw] text-center transition-opacity duration-400 ${visible ? "opacity-100" : "opacity-0"} ${
          transparent ? "max-w-[36vw] rounded-lg bg-black/60 px-6 py-4 shadow-lg backdrop-blur-sm" : ""
        }`}
      >
        <div className={`mb-2 tracking-wide text-amber-400 ${sizeClasses.reference} ${transparent ? "" : "mb-6"}`}>{current?.reference}</div>
        <div className={`whitespace-pre-line leading-relaxed ${sizeClasses.body}`}>{current?.text}</div>
      </div>

      {!transparent && !isFullscreen && (
        <button
          onClick={goFullscreen}
          className={`fixed bottom-6 right-6 rounded-md border px-4 py-2 font-sans text-sm ${
            everEnteredFullscreen ? "border-orange-400 text-orange-400" : "border-neutral-600 bg-neutral-900 text-neutral-100"
          }`}
        >
          {everEnteredFullscreen ? "Click to resume fullscreen" : "Go Fullscreen"}
        </button>
      )}
    </div>
  );
}

export default function OverlayPage() {
  return (
    <Suspense fallback={null}>
      <OverlayContent />
    </Suspense>
  );
}
