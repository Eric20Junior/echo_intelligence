// First-run API key setup (roadmap Phase 6). Deliberately standalone — must not
// require lib/server/api-server.js, lib/server/session.js, or anything that transitively
// requires lib/llm-fallback.js, since that module constructs its Anthropic
// client at require-time from process.env.ANTHROPIC_API_KEY. If we required it
// before the operator has entered a key, it'd construct with an undefined key
// and never pick up the saved one without a real process restart — the same
// require-order landmine documented in docs/roadmap.md from earlier tonight.
const http = require("http");
const config = require("../config");

const NEEDS_ANTHROPIC = config.getDetectorBackend() === "anthropic";

const ANTHROPIC_FIELD = NEEDS_ANTHROPIC
  ? `<label for="anthropic">Anthropic API key (<a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>)</label>
  <input id="anthropic" type="password" autocomplete="off" />`
  : "";

const SETUP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Echo Intelligence — Setup</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #16161a; color: #f0f0ec; font-family: system-ui, sans-serif; }
  #app { max-width: 480px; margin: 0 auto; padding: 3rem 1.5rem; }
  h1 { font-size: 1.2rem; color: #d4af37; }
  p { font-size: 0.9rem; color: #ccc; line-height: 1.5; }
  label { display: block; font-size: 0.85rem; color: #999; margin-top: 1.2rem; margin-bottom: 0.3rem; }
  input {
    width: 100%; box-sizing: border-box; font-size: 0.95rem; padding: 0.6rem 0.8rem;
    border-radius: 6px; border: 1px solid #444; background: #222; color: inherit;
  }
  button {
    margin-top: 1.5rem; width: 100%; font-size: 0.95rem; padding: 0.7rem;
    border-radius: 6px; border: 1px solid #444; background: #1e5c3a; color: #f0f0ec; cursor: pointer;
  }
  #message { margin-top: 1rem; font-size: 0.85rem; }
  #message.error { color: #e08a4a; }
  #message.success { color: #6fc98a; }
  a { color: #d4af37; }
</style>
</head>
<body>
<div id="app">
  <h1>Echo Intelligence — First-time setup</h1>
  <p>Enter your API keys once. They're saved to your user profile so you won't need to enter them again.</p>
  <label for="deepgram">Deepgram API key (<a href="https://console.deepgram.com" target="_blank">console.deepgram.com</a>)</label>
  <input id="deepgram" type="password" autocomplete="off" />
  ${ANTHROPIC_FIELD}
  <button id="save-btn">Save and continue</button>
  <div id="message"></div>
</div>
<script>
  const saveBtn = document.getElementById("save-btn");
  const messageEl = document.getElementById("message");
  saveBtn.addEventListener("click", async () => {
    const deepgramApiKey = document.getElementById("deepgram").value.trim();
    const anthropicEl = document.getElementById("anthropic");
    const anthropicApiKey = anthropicEl ? anthropicEl.value.trim() : "";
    saveBtn.disabled = true;
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deepgramApiKey, anthropicApiKey }),
    });
    const body = await res.json();
    if (res.ok) {
      messageEl.textContent = "Saved. Close this window and restart the app to continue.";
      messageEl.className = "success";
    } else {
      messageEl.textContent = body.error || "Something went wrong.";
      messageEl.className = "error";
      saveBtn.disabled = false;
    }
  });
</script>
</body>
</html>`;

function start(port) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SETUP_HTML);
      return;
    }

    if (req.method === "POST" && req.url === "/api/setup") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          const { deepgramApiKey, anthropicApiKey } = JSON.parse(raw);
          if (!deepgramApiKey || (NEEDS_ANTHROPIC && !anthropicApiKey)) {
            throw new Error(NEEDS_ANTHROPIC ? "Both keys are required." : "Deepgram key is required.");
          }
          config.saveConfig({ deepgramApiKey, anthropicApiKey });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log("\nKeys saved. Restart the app to continue.");
          server.close();
          setTimeout(() => process.exit(0), 500);
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.log(`First-time setup required — open http://localhost:${port} and enter your API keys.`);
  });

  return server;
}

module.exports = { start };
