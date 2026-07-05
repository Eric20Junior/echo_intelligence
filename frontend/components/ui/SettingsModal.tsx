"use client";

import { useEffect, useState } from "react";
import { BACKEND_HTTP_ORIGIN } from "@/lib/backend";
import type {
  AliasSuggestion,
  AliasSuggestionsResponse,
  ConfigStatus,
  MicDevice,
  OperatorSettings,
  PhraseSuggestion,
  PhraseSuggestionsResponse,
  ReadingNavSuggestion,
  ReadingNavSuggestionsResponse,
  ServiceSection,
  TranslationsInfo,
} from "@/lib/types";

type Section = "audio" | "speech" | "service" | "bible" | "display" | "remote" | "keys" | "suggestions" | "help";

const SERVICE_SECTIONS: ServiceSection[] = ["worship", "sermon", "response"];

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "audio", label: "Audio", icon: "🎙" },
  { id: "speech", label: "Speech Recognition", icon: "💬" },
  { id: "service", label: "Service Section", icon: "⛪" },
  { id: "bible", label: "Bible", icon: "📖" },
  { id: "display", label: "Display Mode", icon: "🖥" },
  { id: "remote", label: "Remote Control", icon: "📡" },
  { id: "keys", label: "API Keys", icon: "🔑" },
  { id: "suggestions", label: "Suggestions", icon: "💡" },
  { id: "help", label: "Help", icon: "❓" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  devices: MicDevice[];
  selectedDevice: string;
  onSelectDevice: (id: string) => void;
  deviceLocked: boolean;
  settings: OperatorSettings;
  onUpdateSetting: (key: keyof OperatorSettings, value: boolean | number) => void;
  translations: TranslationsInfo;
  viewer: boolean;
  isController: boolean;
  section: ServiceSection;
  onSetServiceSection: (value: ServiceSection) => void;
}

export function SettingsModal({
  open,
  onClose,
  devices,
  selectedDevice,
  onSelectDevice,
  deviceLocked,
  settings,
  onUpdateSetting,
  translations,
  viewer,
  isController,
  section: serviceSection,
  onSetServiceSection,
}: Props) {
  const [section, setSection] = useState<Section>("audio");
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [deepgramKey, setDeepgramKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [aliasSuggestions, setAliasSuggestions] = useState<AliasSuggestion[]>([]);
  const [phraseSuggestions, setPhraseSuggestions] = useState<PhraseSuggestion[]>([]);
  const [readingNavSuggestions, setReadingNavSuggestions] = useState<ReadingNavSuggestion[]>([]);

  useEffect(() => {
    if (!open || section !== "keys") return;
    fetch(`${BACKEND_HTTP_ORIGIN}/api/config`)
      .then((res) => res.json())
      .then(setConfigStatus);
  }, [open, section]);

  useEffect(() => {
    // Fetched whenever the modal opens (not gated to the Suggestions section)
    // so the sidebar badge count is accurate right away, not just after
    // visiting that section once.
    if (!open) return;
    fetch(`${BACKEND_HTTP_ORIGIN}/api/alias-suggestions`).then((res) => res.json()).then((body: AliasSuggestionsResponse) => setAliasSuggestions(body.suggestions));
    fetch(`${BACKEND_HTTP_ORIGIN}/api/phrase-suggestions`).then((res) => res.json()).then((body: PhraseSuggestionsResponse) => setPhraseSuggestions(body.suggestions));
    fetch(`${BACKEND_HTTP_ORIGIN}/api/reading-nav-suggestions`).then((res) => res.json()).then((body: ReadingNavSuggestionsResponse) => setReadingNavSuggestions(body.suggestions));
  }, [open]);

  if (!open) return null;

  async function resolveAliasSuggestion(suggestion: AliasSuggestion, action: "approve" | "reject" | "ignore") {
    await fetch(`${BACKEND_HTTP_ORIGIN}/api/alias-suggestions/${suggestion.id}/${action}`, { method: "POST" });
    setAliasSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  }

  async function resolvePhraseSuggestion(suggestion: PhraseSuggestion, action: "approve" | "reject" | "ignore") {
    await fetch(`${BACKEND_HTTP_ORIGIN}/api/phrase-suggestions/${suggestion.id}/${action}`, { method: "POST" });
    setPhraseSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  }

  async function resolveReadingNavSuggestion(suggestion: ReadingNavSuggestion, action: "approve" | "reject" | "ignore") {
    await fetch(`${BACKEND_HTTP_ORIGIN}/api/reading-nav-suggestions/${suggestion.id}/${action}`, { method: "POST" });
    setReadingNavSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  }

  async function saveKeys() {
    const res = await fetch(`${BACKEND_HTTP_ORIGIN}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deepgramApiKey: deepgramKey.trim() || undefined, anthropicApiKey: anthropicKey.trim() || undefined }),
    });
    if (res.ok) {
      setSaveMessage("Saved — restart the app for the new key to take effect.");
      setDeepgramKey("");
      setAnthropicKey("");
      fetch(`${BACKEND_HTTP_ORIGIN}/api/config`).then((r) => r.json()).then(setConfigStatus);
    } else {
      setSaveMessage("Couldn't save — at least one key is required.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex h-[560px] w-[760px] overflow-hidden rounded-md border border-border-1 bg-bg-1 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-48 flex-none flex-col gap-0.5 border-r border-border-1 bg-bg-2 p-3">
          <div className="mb-2 px-2 text-sm font-semibold text-text-1">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                section === s.id ? "bg-bg-1 font-semibold text-text-1" : "text-text-2 hover:bg-bg-1/50"
              }`}
            >
              <span>{s.icon}</span>
              <span className="flex-1">{s.label}</span>
              {s.id === "suggestions" && aliasSuggestions.length + phraseSuggestions.length + readingNavSuggestions.length > 0 && (
                <span className="font-mono text-xs text-pending">
                  {aliasSuggestions.length + phraseSuggestions.length + readingNavSuggestions.length}
                </span>
              )}
            </button>
          ))}
        </aside>

        <div className="flex flex-1 flex-col">
          <div className="flex flex-none items-center justify-between border-b border-border-1 px-5 py-3">
            <h2 className="text-base font-semibold text-text-1">{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <button onClick={onClose} className="text-text-3 hover:text-text-1" aria-label="Close settings">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {section === "audio" && (
              <div className="flex flex-col gap-5">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-caps text-text-3">Input device</div>
                  <select
                    value={selectedDevice}
                    onChange={(e) => onSelectDevice(e.target.value)}
                    disabled={deviceLocked || viewer}
                    className="h-control w-full rounded-sm border border-border-2 bg-bg-2 px-2 text-base text-text-1"
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-text-3">Selected device persists across sessions.</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-caps text-text-3">
                    <span>Input gain</span>
                    <span className="font-mono normal-case">{Math.round(settings.gain * 50)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.gain}
                    disabled={viewer}
                    onChange={(e) => onUpdateSetting("gain", Number(e.target.value))}
                    className="w-full"
                  />
                  <p className="mt-1 text-xs text-text-3">Amplifies the incoming audio signal before transcription. 50% is unity gain.</p>
                </div>
              </div>
            )}

            {section === "speech" && (
              <div className="flex flex-col gap-4">
                <label className="flex items-start gap-2 text-sm text-text-1">
                  <input
                    type="checkbox"
                    checked={settings.confirmAll}
                    disabled={viewer}
                    onChange={(e) => onUpdateSetting("confirmAll", e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <div className="font-semibold">Confirm before live</div>
                    <div className="text-xs text-text-3">Every detection goes to the pending queue, even high-confidence ones.</div>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-text-1">
                  <input
                    type="checkbox"
                    checked={settings.collapseRepeats}
                    disabled={viewer}
                    onChange={(e) => onUpdateSetting("collapseRepeats", e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <div className="font-semibold">Collapse repeats</div>
                    <div className="text-xs text-text-3">A re-detected reference bumps its existing pending card instead of adding a new one.</div>
                  </span>
                </label>
              </div>
            )}

            {section === "service" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  {SERVICE_SECTIONS.map((s) => (
                    <button
                      key={s}
                      disabled={viewer}
                      onClick={() => onSetServiceSection(s)}
                      className={`h-control rounded-sm border px-3 text-sm font-semibold capitalize ${
                        serviceSection === s ? "border-gold bg-gold-wash text-gold" : "border-border-2 text-text-2 hover:bg-bg-2"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-3">Detection pauses entirely during Worship (music causes false positives).</p>
              </div>
            )}

            {section === "suggestions" && (
              <div className="flex flex-col gap-6">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-caps text-text-3">Suggested aliases</h3>
                    <span className="text-xs text-text-3">Recurring mis-heard phrases — nothing changes until you approve</span>
                  </div>
                  <div className="rounded-md border border-border-1 bg-bg-2 p-1.5">
                    {aliasSuggestions.length === 0 && <div className="p-3 text-sm text-text-3">No suggestions right now.</div>}
                    {aliasSuggestions.map((s, i) => (
                      <div key={s.id} className={`flex flex-col gap-2 px-3 py-3 ${i < aliasSuggestions.length - 1 ? "border-b border-border-1" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-sm">
                            <span className="font-mono font-semibold text-text-1">&ldquo;{s.aliasText}&rdquo;</span> was typed as{" "}
                            <span className="font-serif font-semibold text-gold">{s.bookName}</span> {s.occurrenceCount}x across {s.distinctDatesCount} services
                          </span>
                          <button disabled={viewer} onClick={() => resolveAliasSuggestion(s, "approve")} className="rounded-sm bg-gold px-2.5 py-1 text-xs font-semibold text-bg-1">Yes</button>
                          <button disabled={viewer} onClick={() => resolveAliasSuggestion(s, "reject")} className="rounded-sm border border-border-2 px-2.5 py-1 text-xs">No</button>
                          <button disabled={viewer} onClick={() => resolveAliasSuggestion(s, "ignore")} className="px-2.5 py-1 text-xs text-text-3">Later</button>
                        </div>
                        {s.sampleRawTexts.length > 0 && <div className="text-xs text-text-3">e.g. {s.sampleRawTexts.map((t) => `"${t}"`).join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-caps text-text-3">Suggested verse lookups</h3>
                    <span className="text-xs text-text-3">Ways of describing a verse without citing it</span>
                  </div>
                  <div className="rounded-md border border-border-1 bg-bg-2 p-1.5">
                    {phraseSuggestions.length === 0 && <div className="p-3 text-sm text-text-3">No suggestions right now.</div>}
                    {phraseSuggestions.map((s, i) => (
                      <div key={s.id} className={`flex flex-col gap-2 px-3 py-3 ${i < phraseSuggestions.length - 1 ? "border-b border-border-1" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-sm">
                            Similar wording pointed to <span className="font-serif font-semibold text-gold">{s.bookName} {s.chapter}:{s.verseStart}</span> {s.occurrenceCount}x across {s.distinctDatesCount} services
                          </span>
                          <button disabled={viewer} onClick={() => resolvePhraseSuggestion(s, "approve")} className="rounded-sm bg-gold px-2.5 py-1 text-xs font-semibold text-bg-1">Yes</button>
                          <button disabled={viewer} onClick={() => resolvePhraseSuggestion(s, "reject")} className="rounded-sm border border-border-2 px-2.5 py-1 text-xs">No</button>
                          <button disabled={viewer} onClick={() => resolvePhraseSuggestion(s, "ignore")} className="px-2.5 py-1 text-xs text-text-3">Later</button>
                        </div>
                        {s.sampleRawTexts.length > 0 && <div className="text-xs text-text-3">e.g. {s.sampleRawTexts.map((t) => `"${t}"`).join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-caps text-text-3">Suggested reading navigation</h3>
                    <span className="text-xs text-text-3">Ways of saying "verse N" while reading a chapter aloud</span>
                  </div>
                  <div className="rounded-md border border-border-1 bg-bg-2 p-1.5">
                    {readingNavSuggestions.length === 0 && <div className="p-3 text-sm text-text-3">No suggestions right now.</div>}
                    {readingNavSuggestions.map((s, i) => (
                      <div key={s.id} className={`flex flex-col gap-2 px-3 py-3 ${i < readingNavSuggestions.length - 1 ? "border-b border-border-1" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-sm">
                            Similar phrasing pointed to <span className="font-serif font-semibold text-gold">{s.bookName} {s.chapter}:{s.verseStart}</span> {s.occurrenceCount}x across {s.distinctDatesCount} services
                          </span>
                          <button disabled={viewer} onClick={() => resolveReadingNavSuggestion(s, "approve")} className="rounded-sm bg-gold px-2.5 py-1 text-xs font-semibold text-bg-1">Yes</button>
                          <button disabled={viewer} onClick={() => resolveReadingNavSuggestion(s, "reject")} className="rounded-sm border border-border-2 px-2.5 py-1 text-xs">No</button>
                          <button disabled={viewer} onClick={() => resolveReadingNavSuggestion(s, "ignore")} className="px-2.5 py-1 text-xs text-text-3">Later</button>
                        </div>
                        {s.sampleRawTexts.length > 0 && <div className="text-xs text-text-3">e.g. {s.sampleRawTexts.map((t) => `"${t}"`).join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {section === "bible" && (
              <div className="flex flex-col gap-3">
                {translations.options.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between rounded-sm border px-3 py-2 ${
                      t.id === translations.current ? "border-gold bg-gold-wash" : "border-border-1"
                    } ${!t.available ? "opacity-60" : ""}`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-text-1">{t.label} ({t.id})</div>
                      {!t.available && <div className="text-xs text-text-3">{t.reason}</div>}
                    </div>
                    {t.id === translations.current ? (
                      <span className="text-xs font-semibold text-gold">Active</span>
                    ) : (
                      <span className="text-xs text-text-3">Coming soon</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {section === "display" && (
              <p className="text-sm text-text-3">
                Projector display styling (fonts, colors, verse layout) isn&apos;t configurable yet — the overlay page uses fixed styling.
              </p>
            )}

            {section === "remote" && (
              <div className="flex flex-col gap-2 text-sm text-text-1">
                <div>
                  You are currently: <span className="font-semibold">{isController ? "Controller" : "Viewer"}</span>
                </div>
                <p className="text-xs text-text-3">
                  Only one operator tab can control the service at a time. Other tabs (e.g. a second volunteer&apos;s laptop) connect as view-only
                  automatically, and control hands over if the controller&apos;s tab disconnects.
                </p>
              </div>
            )}

            {section === "keys" && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-caps text-text-3">Deepgram API key</div>
                  <input
                    type="password"
                    placeholder={configStatus?.deepgramConfigured ? "•••••••• (configured)" : "Not set"}
                    value={deepgramKey}
                    onChange={(e) => setDeepgramKey(e.target.value)}
                    className="h-control w-full rounded-sm border border-border-2 bg-bg-2 px-2 text-base text-text-1"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-caps text-text-3">Anthropic API key</div>
                  <input
                    type="password"
                    placeholder={configStatus?.anthropicConfigured ? "•••••••• (configured)" : "Not set"}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    className="h-control w-full rounded-sm border border-border-2 bg-bg-2 px-2 text-base text-text-1"
                  />
                </div>
                <button
                  onClick={saveKeys}
                  className="h-control w-fit rounded-sm bg-gold px-4 text-sm font-semibold text-bg-1"
                >
                  Save
                </button>
                {saveMessage && <p className="text-xs text-text-3">{saveMessage}</p>}
              </div>
            )}

            {section === "help" && (
              <div className="flex flex-col gap-2 text-sm text-text-3">
                <p>Echo Intelligence listens to the service audio, detects spoken scripture references, and puts them on the projector.</p>
                <p>Confirm or reject detections from the Waiting queue. The app improves its own accuracy over time — check Suggestions periodically for corrections it noticed on its own.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
