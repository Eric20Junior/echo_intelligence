// Presentational-only state for the design system's LiveIndicator — not part
// of the backend WS contract (see lib/types.ts for that).
export type ListeningState = "listening" | "idle" | "connecting" | "error";
