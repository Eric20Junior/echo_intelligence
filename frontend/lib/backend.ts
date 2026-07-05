// Backend connection details for the existing Node/WebSocket server (unchanged
// from the plain-HTML pages it replaces — see lib/overlay-server.js in the repo
// root). Configurable via env var since Next.js's dev server runs on a
// different port/origin (3000) than the backend (8787) — WS/fetch calls need
// the full origin, not relative paths.
const BACKEND_HOST = process.env.NEXT_PUBLIC_BACKEND_HOST || "localhost:8787";

export const BACKEND_HTTP_ORIGIN = `http://${BACKEND_HOST}`;
export const BACKEND_WS_ORIGIN = `ws://${BACKEND_HOST}`;
