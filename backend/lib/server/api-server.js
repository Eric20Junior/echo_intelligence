const express = require("express");
const { WebSocketServer } = require("ws");
const url = require("url");
const fs = require("fs");
const { resolvePath } = require("../paths");
const session = require("./session");
const presentation = require("./presentation");
const deviceRoutes = require("./routes/deviceRoutes");
const manualRoutes = require("./routes/manualRoutes");
const historyRoutes = require("./routes/historyRoutes");
const configRoutes = require("./routes/configRoutes");
const planRoutes = require("./routes/planRoutes");
const aliasSuggestionsRoutes = require("./routes/aliasSuggestionsRoutes");
const phraseSuggestionsRoutes = require("./routes/phraseSuggestionsRoutes");
const readingNavSuggestionsRoutes = require("./routes/readingNavSuggestionsRoutes");

// Permissive CORS on the JSON API — needed since the Next.js frontend
// (frontend/) runs on its own dev-server origin (localhost:3000) and talks to
// this backend (localhost:8787) via plain fetch(), which enforces CORS unlike
// the WebSocket connection below. `*` rather than a hardcoded origin since
// this is a local-network tool, not an internet-facing service handling
// untrusted origins, and it avoids breaking if the frontend's dev port or
// packaged serving origin ever changes.
function cors(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

// Serves a role-tagged WebSocket (?role=overlay|operator) and the mic/session
// control API — the frontend/ Next.js app owns the actual UI pages.
// Deliberately one process, one port, no Electron — see roadmap Phase 5/3.
function start(port) {
  const app = express();
  app.use(express.json());
  app.use("/api", cors);
  app.use("/api", deviceRoutes);
  app.use("/api", manualRoutes);
  app.use("/api", historyRoutes);
  app.use("/api", configRoutes);
  app.use("/api", planRoutes);
  app.use("/api", aliasSuggestionsRoutes);
  app.use("/api", phraseSuggestionsRoutes);
  app.use("/api", readingNavSuggestionsRoutes);

  // Serves the frontend's static export (frontend/scripts/package.js runs
  // `next build` with output: "export" and copies frontend/out/ here) when
  // packaged, so one process/port serves both the API and the UI — no
  // separate Next server needed. In dev this directory doesn't exist (the
  // frontend runs via `next dev` on its own port instead), so this is a no-op.
  const publicDir = resolvePath("public");
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  const server = app.listen(port, () => {
    console.log(`operator: http://localhost:${port}/`);
    console.log(`overlay: http://localhost:${port}/overlay`);
  });

  const wss = new WebSocketServer({ server });
  const clientsByRole = { overlay: new Set(), operator: new Set() };

  // Multi-operator lock (roadmap Phase 8 step 5): the first operator tab to
  // connect gets control; later ones are view-only. Enforced here, not just in
  // the frontend UI — a viewer's action messages are silently ignored below,
  // so a second tab can't act even if its own disabled-state rendering were
  // somehow bypassed.
  //
  // Tracked by clientId (a stable id the frontend generates once per browser
  // tab via sessionStorage — see frontend/lib/useEchoSocket.ts), not by the
  // raw WebSocket object. A single tab can open more than one real underlying
  // connection in quick succession (React Strict Mode's dev-only double-invoke
  // of effects is the common case, but any reconnect races the same way) —
  // tracking by socket reference alone can't tell that apart from a genuinely
  // different second operator, and loses control on every such remount.
  let controller = null; // { clientId, ws }

  function promoteNextController(excludeClientId) {
    controller = null;
    for (const client of clientsByRole.operator) {
      if (client.readyState === client.OPEN && client.clientId !== excludeClientId) {
        controller = { clientId: client.clientId, ws: client };
        client.send(JSON.stringify({ type: "lock", role: "control" }));
        break;
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const { query } = url.parse(req.url, true);
    const role = query.role === "overlay" ? "overlay" : "operator";
    const clientId = query.clientId || null;
    ws.clientId = clientId;
    clientsByRole[role].add(ws);

    // Heartbeat (standard `ws` pattern): an uncleanly-dropped connection (wifi
    // drop, laptop sleep, browser crash) may never deliver a TCP FIN, so the
    // server's 'close' event can be delayed indefinitely or never fire at all.
    // Without this, a dead controller connection would permanently lock the
    // control role — a real risk for an operator's laptop mid-service, not
    // just a hypothetical. Ping every 30s; terminate anyone who didn't pong
    // since the last check.
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("close", () => {
      clientsByRole[role].delete(ws);
      // Only demote if this was the controller's *current* socket — a stale
      // connection from the same tab's earlier remount closing later shouldn't
      // evict whatever connection from that same clientId has since taken over.
      if (role === "operator" && controller?.ws === ws) promoteNextController(clientId);
    });

    if (role === "operator") {
      const isSameClientReconnecting = controller?.clientId === clientId;
      const isController = controller === null || isSameClientReconnecting;
      if (isController) controller = { clientId, ws };
      ws.send(JSON.stringify({ type: "snapshot", ...presentation.getSnapshot() }));
      ws.send(JSON.stringify({ type: "lock", role: isController ? "control" : "viewer" }));

      ws.on("message", (raw) => {
        if (controller?.ws !== ws) return; // viewers can't act, regardless of what they send
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "approve") presentation.approve(msg.id);
        else if (msg.type === "reject") presentation.reject(msg.id);
        else if (msg.type === "nudge") presentation.nudge(msg.id, msg.delta === 1 ? 1 : -1);
        else if (msg.type === "setting") presentation.setSetting(msg.key, msg.value);
        else if (msg.type === "section") presentation.setSection(msg.value);
      });
    }
  });

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate(); // fires 'close' immediately, triggering promoteNextController if needed
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on("close", () => clearInterval(heartbeatInterval));

  function broadcast(role, payload) {
    const message = JSON.stringify(payload);
    for (const client of clientsByRole[role]) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  }

  return { server, broadcast };
}

module.exports = { start };
