"use client";

import { useEffect, useState } from "react";
import { useEchoSocket } from "@/lib/useEchoSocket";
import type { OverlayMessage } from "@/lib/types";

export default function OverlayPage() {
  const [current, setCurrent] = useState<OverlayMessage | null>(null);
  const [everEnteredFullscreen, setEverEnteredFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Only auto_display/approved detections ever reach this page — `suggest`
  // status is queued for operator approval instead (see the operator page).
  useEchoSocket<OverlayMessage>("overlay", (msg) => setCurrent(msg));

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

  return (
    <div className="flex h-screen items-center justify-center bg-black font-serif text-neutral-100">
      <div className={`max-w-[80vw] text-center transition-opacity duration-400 ${current ? "opacity-100" : "opacity-0"}`}>
        <div className="mb-6 text-[3vw] tracking-wide text-amber-400">{current?.reference}</div>
        <div className="whitespace-pre-line text-[2.2vw] leading-relaxed">{current?.text}</div>
      </div>

      {!isFullscreen && (
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
