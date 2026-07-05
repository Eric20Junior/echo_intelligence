"use client";

import { useEffect, useRef, useState } from "react";
import { BACKEND_WS_ORIGIN } from "./backend";

// Stable per-tab identity, surviving both real reconnects and React Strict
// Mode's dev-only double-invoke of effects (which opens two real WebSocket
// connections in quick succession for a single mount). Without this, the
// backend's multi-operator lock (roadmap Phase 8 step 5) can't tell "the same
// tab reconnecting" from "a genuinely different second operator" — sessionStorage
// (not module state) survives the remount, tab-scoped, gone on tab close.
function getClientId(): string {
  if (typeof window === "undefined") return "";
  const key = "echo-client-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

// Reconnecting WebSocket to the backend, tagged by role (?role=overlay|operator
// — see lib/overlay-server.js). Reconnects with a 1s delay on close, matching
// the reconnect behavior the old static pages used. Returns a ref whose
// `.current.send(...)` can be used by callers (e.g. the operator page sending
// approve/reject messages) once connected, plus a `connected` flag for UI
// (connection-lost banners, status indicators).
export function useEchoSocket<T>(role: "overlay" | "operator", onMessage: (msg: T) => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket;
    const clientId = getClientId();

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(`${BACKEND_WS_ORIGIN}?role=${role}&clientId=${clientId}`);
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        onMessageRef.current(JSON.parse(event.data) as T);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) setTimeout(connect, 1000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [role]);

  return { socketRef, connected };
}
