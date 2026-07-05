"use client";

import { useCallback, useEffect, useState } from "react";
import { useEchoSocket } from "@/lib/useEchoSocket";
import { BACKEND_HTTP_ORIGIN } from "@/lib/backend";
import type { MicDevice, OperatorMessage, OperatorSettings, OverlayMessage, ServiceSection, StatusResponse, SuggestionEntry, TranslationsInfo } from "@/lib/types";
import type { ListeningState } from "@/lib/design-types";
import { Button } from "@/components/ui/Button";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { AudioMeter } from "@/components/ui/AudioMeter";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SuggestionCard } from "@/components/ui/SuggestionCard";
import { FeedItem } from "@/components/ui/FeedItem";
import { ToastStack, useToasts } from "@/components/ui/Toast";
import { SettingsModal } from "@/components/ui/SettingsModal";

const DEFAULT_SETTINGS: OperatorSettings = { confirmAll: false, collapseRepeats: true, gain: 1 };
const DEFAULT_TRANSLATIONS: TranslationsInfo = { current: "KJV", options: [{ id: "KJV", label: "King James Version", available: true }] };

// The projector's own VerseDisplay sizes itself off the real browser viewport
// (vw units, meant for a full-screen second display), so it can't be dropped
// into a small, width-varying dashboard tile — a fixed-size box scaled down
// with a hardcoded transform looked right at one window width and broke at
// any other. This is a genuinely responsive stand-in for those preview tiles.
function MiniPreview({ reference, translation, text }: { reference: string; translation?: string; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 overflow-hidden px-4 text-center">
      <div className="flex items-baseline gap-2">
        <span className="truncate font-serif text-base font-semibold text-reference">{reference}</span>
        {translation && <span className="text-[10px] font-medium uppercase tracking-caps text-gold-dim">{translation}</span>}
      </div>
      <div className="h-0.5 w-8 shrink-0 bg-gold-dim opacity-80" />
      <p className="line-clamp-6 font-serif text-sm leading-snug text-scripture">{text}</p>
    </div>
  );
}

export default function OperatorPage() {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("default");
  const [active, setActive] = useState(false);
  const [readingMode, setReadingMode] = useState<StatusResponse["readingMode"]>(null);
  const [pending, setPending] = useState<SuggestionEntry[]>([]);
  const [recent, setRecent] = useState<OverlayMessage[]>([]);
  const [settings, setSettings] = useState<OperatorSettings>(DEFAULT_SETTINGS);
  const [manualRef, setManualRef] = useState("");
  const [section, setSectionState] = useState<ServiceSection>("sermon");
  const [audioLevel, setAudioLevel] = useState(0);
  const [viewer, setViewer] = useState(false);
  const [translations, setTranslations] = useState<TranslationsInfo>(DEFAULT_TRANSLATIONS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const { toasts, push, dismiss } = useToasts();

  const refreshStatus = useCallback(async () => {
    const res = await fetch(`${BACKEND_HTTP_ORIGIN}/api/status`);
    const body: StatusResponse = await res.json();
    setActive(body.active);
    setReadingMode(body.readingMode);
    setSettings(body.settings);
    setSectionState(body.section);
    setTranslations(body.translations);
  }, []);

  const { socketRef, connected } = useEchoSocket<OperatorMessage>("operator", (msg) => {
    if (msg.type === "snapshot") {
      setPending(msg.pending);
      setRecent(msg.recent);
    } else if (msg.type === "suggestion_added") {
      setPending((prev) => {
        const exists = prev.some((s) => s.id === msg.entry.id);
        return exists ? prev.map((s) => (s.id === msg.entry.id ? msg.entry : s)) : [...prev, msg.entry];
      });
    } else if (msg.type === "suggestion_resolved") {
      setPending((prev) => prev.filter((s) => s.id !== msg.id));
      if (msg.action === "approved") refreshStatus(); // may have locked reading-mode state
    } else if (msg.type === "auto_display") {
      setRecent((prev) => [...prev.slice(-19), msg.entry]);
      refreshStatus(); // may have locked reading-mode state
    } else if (msg.type === "setting_updated") {
      setSettings((prev) => ({ ...prev, [msg.key]: msg.value }));
    } else if (msg.type === "section_updated") {
      setSectionState(msg.value);
    } else if (msg.type === "audio_level") {
      setAudioLevel(msg.level);
    } else if (msg.type === "transcript") {
      setTranscript((prev) => [...prev.slice(-19), msg.text]);
    } else if (msg.type === "lock") {
      setViewer(msg.role === "viewer");
    }
  });

  useEffect(() => {
    fetch(`${BACKEND_HTTP_ORIGIN}/api/devices`)
      .then((res) => res.json())
      .then((body: { devices: MicDevice[] }) => setDevices(body.devices));
    refreshStatus();
  }, [refreshStatus]);

  function selectedDeviceLabel() {
    return devices.find((d) => d.id === selectedDevice)?.label ?? selectedDevice;
  }

  // Multi-operator lock (roadmap Phase 8 step 5): a second tab connects
  // view-only. The backend already ignores a viewer's WS messages regardless,
  // but gate here too so the UI gives immediate feedback instead of a
  // silently-ignored click.
  function requireControl(): boolean {
    if (viewer) {
      push("info", "View-only", "Another operator tab has control");
      return false;
    }
    return true;
  }

  function resolveSuggestion(id: string, action: "approve" | "reject") {
    if (!requireControl()) return;
    const s = pending.find((p) => p.id === id);
    socketRef.current?.send(JSON.stringify({ type: action, id }));
    if (s) push(action === "approve" ? "success" : "danger", action === "approve" ? "Displayed" : "Rejected", s.reference);
  }

  function clearQueue() {
    if (!requireControl()) return;
    for (const s of pending) socketRef.current?.send(JSON.stringify({ type: "reject", id: s.id }));
  }

  function nudgeSuggestion(id: string, delta: -1 | 1) {
    if (!requireControl()) return;
    socketRef.current?.send(JSON.stringify({ type: "nudge", id, delta }));
  }

  function updateSetting(key: keyof OperatorSettings, value: boolean | number) {
    if (!requireControl()) return;
    setSettings((prev) => ({ ...prev, [key]: value }));
    socketRef.current?.send(JSON.stringify({ type: "setting", key, value }));
  }

  // Enter confirms / Esc rejects the oldest pending suggestion.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
      const top = pending[0];
      if (!top) return;
      if (e.key === "Enter") resolveSuggestion(top.id, "approve");
      if (e.key === "Escape") resolveSuggestion(top.id, "reject");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  async function handleStart() {
    if (!requireControl()) return;
    const res = await fetch(`${BACKEND_HTTP_ORIGIN}/api/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: selectedDevice }),
    });
    if (res.ok) push("success", "Listening started", selectedDeviceLabel());
    refreshStatus();
  }

  async function handleStop() {
    if (!requireControl()) return;
    await fetch(`${BACKEND_HTTP_ORIGIN}/api/stop`, { method: "POST" });
    push("info", "Stopped listening");
    setAudioLevel(0);
    setTranscript([]);
    refreshStatus();
  }

  async function handleManualDisplay() {
    if (!requireControl()) return;
    const reference = manualRef.trim();
    if (!reference) return;
    const res = await fetch(`${BACKEND_HTTP_ORIGIN}/api/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    });
    const body = await res.json();
    if (res.ok) {
      push("success", "Displayed", body.reference);
      setManualRef("");
    } else {
      push("danger", "Couldn't display that", body.error);
    }
  }

  async function redisplayFromHistory(entry: OverlayMessage) {
    if (!requireControl()) return;
    const res = await fetch(`${BACKEND_HTTP_ORIGIN}/api/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: entry.reference }),
    });
    const body = await res.json();
    if (res.ok) {
      push("success", "Displayed", body.reference);
    } else {
      push("danger", "Couldn't display that", body.error);
    }
  }

  function setSection(value: ServiceSection) {
    if (!requireControl()) return;
    setSectionState(value);
    socketRef.current?.send(JSON.stringify({ type: "section", value }));
  }

  const current = recent[recent.length - 1];
  const listeningState: ListeningState = !connected ? "error" : active ? "listening" : "idle";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-bg-1 font-sans text-text-1">
      {!connected && (
        <div className="flex items-center justify-center gap-2.5 border-b border-danger bg-danger-wash p-2 text-base font-semibold text-danger">
          <span className="h-2 w-2 animate-pulse-dot rounded-pill bg-danger" />
          Connection lost — reconnecting… the projector keeps its last verse.
        </div>
      )}
      {connected && viewer && (
        <div className="flex items-center justify-center gap-2.5 border-b border-info bg-info-wash p-2 text-base font-semibold text-info">
          View-only — another operator tab has control.
        </div>
      )}

      <header className="flex flex-none items-center gap-4 border-b-2 border-gold-dim bg-bg-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold-dim font-serif text-sm font-semibold text-gold">E</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-xl font-semibold text-gold">Echo</span>
            <span className="text-xl text-text-2">Intelligence</span>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 rounded-sm border-l-2 border-gold-dim bg-bg-1 px-3 py-1.5">
          <LiveIndicator state={listeningState} />
          <span className="h-4 w-px bg-border-2" />
          <AudioMeter level={audioLevel} active={active} />
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-control items-center gap-1.5 rounded-sm border border-border-2 px-3 text-xs font-semibold text-text-2 hover:bg-bg-1 hover:border-gold-dim"
        >
          ⚙ Settings
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1.1fr_0.9fr_1.3fr_0.9fr]">
            {/* Live transcript */}
            <section className="flex h-80 flex-col overflow-hidden rounded-lg border-t-[3px] border-info bg-bg-2 shadow-card">
              <div className="flex items-center justify-between px-3 py-2.5">
                <h2 className="flex items-center gap-1.5 font-serif text-sm font-semibold text-text-1">🎙 Transcript</h2>
                <StatusBadge status={active ? "listening" : "offline"} label={active ? "On air" : "Off air"} />
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-relaxed text-text-2">
                {transcript.length ? (
                  transcript.map((line, i) => (
                    <p key={i} className={i === transcript.length - 1 ? "text-text-1" : undefined}>{line}</p>
                  ))
                ) : (
                  <p className="text-text-3">{active ? "Listening — waiting for speech…" : 'Click "Start listening" to begin.'}</p>
                )}
              </div>
              <div className="bg-bg-1/60 p-2">
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  disabled={active || viewer}
                  className="mb-2 h-control w-full rounded-sm border border-border-2 bg-bg-1 px-2 text-xs text-text-1"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                {active
                  ? <Button variant="danger" size="sm" className="w-full" disabled={viewer} onClick={handleStop}>Stop listening</Button>
                  : <Button variant="primary" size="sm" className="w-full" disabled={viewer} onClick={handleStart}>Start listening</Button>}
              </div>
            </section>

            {/* Program preview — the next pending suggestion, before it goes live */}
            <section className="flex h-80 flex-col overflow-hidden rounded-lg border-t-[3px] border-pending bg-bg-2 shadow-card">
              <div className="flex items-center justify-between px-3 py-2.5">
                <h2 className="font-serif text-sm font-semibold text-text-1">Up next</h2>
                {pending[0] && <StatusBadge status="pending" label="Suggested" />}
              </div>
              <div className="flex-1 overflow-hidden bg-bg-0">
                {pending[0]
                  ? <MiniPreview reference={pending[0].reference} translation={pending[0].translation} text={pending[0].text} />
                  : <div className="flex h-full items-center justify-center text-xs text-text-3">Nothing queued</div>}
              </div>
            </section>

            {/* Live display — what's actually on the projector right now, the featured panel */}
            <section className="flex h-80 flex-col overflow-hidden rounded-lg border-t-[3px] border-gold bg-bg-2 shadow-card ring-1 ring-gold-dim">
              <div className="flex items-center justify-between px-3 py-2.5">
                <h2 className="font-serif text-sm font-semibold text-gold">On the projector</h2>
                {current ? <StatusBadge status="live" label="Live" /> : <StatusBadge status="offline" label="Idle" />}
              </div>
              <div className="flex-1 overflow-hidden bg-bg-0">
                {current
                  ? <MiniPreview reference={current.reference} translation={current.translation} text={current.text} />
                  : <div className="flex h-full items-center justify-center text-xs text-text-3">Nothing live</div>}
              </div>
            </section>

            {/* Queue — pending suggestions awaiting operator confirmation */}
            <section className="flex h-80 flex-col overflow-hidden rounded-lg border-t-[3px] border-border-2 bg-bg-2 shadow-card">
              <div className="flex items-center justify-between px-3 py-2.5">
                <h2 className="flex items-center gap-1.5 font-serif text-sm font-semibold text-text-1">
                  Waiting
                  {pending.length > 0 && <span className="font-mono text-xs text-pending">{pending.length}</span>}
                </h2>
                {pending.length > 0 && (
                  <button onClick={clearQueue} className="text-xs text-text-3 hover:text-text-1">Clear all</button>
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                {pending.length ? (
                  <div className="flex flex-col gap-2">
                    {pending.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        onConfirm={(id) => resolveSuggestion(id, "approve")}
                        onReject={(id) => resolveSuggestion(id, "reject")}
                        onNudge={viewer ? undefined : nudgeSuggestion}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-4 text-center text-xs text-text-3">
                    Verses will appear here when detected{settings.confirmAll ? "" : " at low confidence"}.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_400px]">
            <section className="rounded-lg border-l-[3px] border-gold-dim bg-bg-2 p-3 shadow-card">
              <h2 className="mb-2 font-serif text-sm font-semibold text-text-1">Look it up</h2>
              <div className="flex gap-2">
                <input
                  value={manualRef}
                  disabled={viewer}
                  onChange={(e) => setManualRef(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualDisplay()}
                  placeholder="e.g. Romans 8:28 or Psalm 23:1-3"
                  className="h-control flex-1 rounded-sm border border-border-2 bg-bg-1 px-2.5 font-mono text-base text-text-1 outline-none focus:border-gold"
                />
                <Button variant="neutral" size="sm" disabled={viewer} onClick={handleManualDisplay}>Display</Button>
              </div>
            </section>

            <section className="rounded-lg border-l-[3px] border-border-2 bg-bg-2 shadow-card">
              <div className="flex items-center justify-between px-3 py-2.5">
                <h2 className="font-serif text-sm font-semibold text-text-1">Recently shown</h2>
              </div>
              <div className="flex flex-col gap-0.5 p-1.5">
                {recent.length === 0 && <div className="p-3 text-sm text-text-3">Verse detections will appear here during transcription.</div>}
                {recent
                  .slice()
                  .reverse()
                  .slice(0, 6)
                  .map((e) => (
                    <FeedItem
                      key={e.id}
                      entry={e}
                      current={current?.id === e.id}
                      disabled={viewer}
                      onRedisplay={() => redisplayFromHistory(e)}
                    />
                  ))}
              </div>
            </section>
          </div>
        </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        devices={devices}
        selectedDevice={selectedDevice}
        onSelectDevice={setSelectedDevice}
        deviceLocked={active}
        settings={settings}
        onUpdateSetting={updateSetting}
        translations={translations}
        viewer={viewer}
        isController={!viewer}
        section={section}
        onSetServiceSection={setSection}
      />
    </main>
  );
}
