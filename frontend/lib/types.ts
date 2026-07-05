// Message shapes for the backend WebSocket contract (see backend/lib/overlay-server.js
// and backend/lib/presentation.js — this file mirrors them, it is not the
// source of truth; if the backend contract changes, update here to match).

export type DetectionStatus = "auto_display" | "suggest";

export interface OverlayMessage {
  id: string;
  status: DetectionStatus;
  reference: string;
  text: string;
  confidence?: number;
  translation?: string;
}

export interface SuggestionEntry {
  id: string;
  status: DetectionStatus;
  reference: string;
  text: string;
  confidence?: number;
  translation?: string;
  /** Bumped instead of duplicated when the same reference re-detects while pending. */
  repeatCount?: number;
  stale?: boolean;
}

export interface OperatorSettings {
  confirmAll: boolean;
  collapseRepeats: boolean;
  gain: number;
}

export type ServiceSection = "worship" | "sermon" | "response";

export interface TranslationOption {
  id: string;
  label: string;
  available: boolean;
  reason?: string;
}

export interface TranslationsInfo {
  current: string;
  options: TranslationOption[];
}

export interface ConfigStatus {
  deepgramConfigured: boolean;
  anthropicConfigured: boolean;
}

export type OperatorMessage =
  | { type: "snapshot"; pending: SuggestionEntry[]; recent: OverlayMessage[] }
  | { type: "auto_display"; entry: OverlayMessage }
  | { type: "suggestion_added"; entry: SuggestionEntry }
  | { type: "suggestion_resolved"; id: string; action: "approved" | "rejected" }
  | { type: "setting_updated"; key: keyof OperatorSettings; value: boolean }
  | { type: "section_updated"; value: ServiceSection }
  | { type: "audio_level"; level: number }
  | { type: "transcript"; text: string }
  | { type: "lock"; role: "control" | "viewer" };

export interface ReadingModeState {
  bookId: string;
  bookName: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  lockedAt: number;
}

export interface StatusResponse {
  active: boolean;
  readingMode: ReadingModeState | null;
  pending: SuggestionEntry[];
  recent: OverlayMessage[];
  settings: OperatorSettings;
  section: ServiceSection;
  translations: TranslationsInfo;
}

export interface MicDevice {
  id: string;
  label: string;
}

export interface PlanItem {
  id: string;
  reference: string;
  note: string;
  displayed: boolean;
}

export interface PlanResponse {
  items: PlanItem[];
  section: ServiceSection;
}

// GET /api/history — a read-only view over backend/data/log.db (every
// detection ever logged, matched or not, displayed or not). `decision` is null
// for rows logged before the History tab existed, and for no_match/invalid
// rows where no operator decision ever applied.
export type HistoryDecision = "auto" | "confirmed" | "rejected" | "pending" | "manual" | null;

export interface HistoryEntry {
  id: number;
  time: string;
  reference: string | null;
  rawText: string;
  status: "auto_display" | "suggest" | "invalid" | "no_match";
  source: string | null;
  confidence: number | null;
  decision: HistoryDecision;
  reason: string | null;
}

export interface HistoryResponse {
  history: HistoryEntry[];
  total: number;
}

// GET /api/alias-suggestions — "improves over time" (see
// backend/lib/detection/alias-miner.js). Always human-reviewed: approving one
// adds it as a "variant"-tier alias at runtime, nothing here is ever applied
// automatically.
export interface AliasSuggestion {
  id: number;
  createdAt: string;
  bookId: string;
  bookName: string;
  aliasText: string;
  occurrenceCount: number;
  distinctDatesCount: number;
  sampleRawTexts: string[];
}

export interface AliasSuggestionsResponse {
  suggestions: AliasSuggestion[];
}

// GET /api/phrase-suggestions — same "improves over time" mechanism as
// AliasSuggestion, but for content-search lookup phrases (backend/lib/
// detection/phrase-miner.js) instead of mis-heard book-name words. Always
// human-reviewed: approving one adds it as a learned word-overlap match at
// runtime, nothing here is ever applied automatically.
export interface PhraseSuggestion {
  id: number;
  createdAt: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verseStart: number;
  occurrenceCount: number;
  distinctDatesCount: number;
  sampleRawTexts: string[];
}

export interface PhraseSuggestionsResponse {
  suggestions: PhraseSuggestion[];
}

// GET /api/reading-nav-suggestions — same "improves over time" mechanism
// again, this time for reading-mode navigation phrasing (backend/lib/
// detection/reading-nav-miner.js) that never says "verse"/"chapter" next to a
// number at all. Same shape as PhraseSuggestion (a target verse + samples),
// kept as its own type since it's a conceptually distinct suggestion kind.
export interface ReadingNavSuggestion {
  id: number;
  createdAt: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verseStart: number;
  occurrenceCount: number;
  distinctDatesCount: number;
  sampleRawTexts: string[];
}

export interface ReadingNavSuggestionsResponse {
  suggestions: ReadingNavSuggestion[];
}
