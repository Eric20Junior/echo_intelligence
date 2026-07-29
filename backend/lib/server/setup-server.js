// First-run API key setup (roadmap Phase 6). Deliberately standalone — must not
// require lib/server/api-server.js, lib/server/session.js, or the detection
// fallbacks. Originally this was because lib/detection/fallback/llm-fallback.js
// constructed its Anthropic client at require-time from ANTHROPIC_API_KEY, so
// requiring it before the operator had entered a key bound an undefined one for
// the life of the process — the require-order landmine in docs/roadmap.md. Both
// cloud fallbacks now resolve their key at call time, so that trap is closed,
// but the separation still earns its keep: this server has to come up on a
// machine with no keys and no verse DB touched yet, and pulling in the live
// server's module graph would load native addons and open the database purely
// to render a key-entry form. Keep it dependency-light.
const http = require("http");
const config = require("../config");

// The detector backend is now an operator choice made here on first run, rather than a
// developer-only env var. DETECTOR_BACKEND still wins if set (see config.js), in which
// case the picker is pre-selected and the choice isn't re-saved.
const BACKEND_LOCKED_BY_ENV = config.DETECTOR_BACKENDS.includes(process.env.DETECTOR_BACKEND);
const INITIAL_BACKEND = config.getDetectorBackend();

const BACKEND_CHOICES = `
  <label>Scripture detection</label>
  <p class="hint">Used only when the built-in word matching can't identify a spoken reference.</p>
  <div id="backends">
    <label class="choice"><input type="radio" name="backend" value="anthropic" /> <span><b>Anthropic Claude</b> — most accurate. Paid, but roughly a cent per service.</span></label>
    <label class="choice"><input type="radio" name="backend" value="gemini" /> <span><b>Google Gemini</b> — free tier, no card required.</span></label>
    <label class="choice"><input type="radio" name="backend" value="local" /> <span><b>On this computer</b> — no internet or key needed, but slow and can interrupt transcription on older machines.</span></label>
  </div>`;

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
  p.hint { font-size: 0.8rem; color: #999; margin: 0.2rem 0 0.6rem; }
  .choice {
    display: flex; gap: 0.6rem; align-items: flex-start; margin: 0 0 0.5rem;
    padding: 0.6rem 0.8rem; border: 1px solid #444; border-radius: 6px;
    font-size: 0.85rem; color: #ccc; cursor: pointer;
  }
  .choice b { color: #f0f0ec; font-weight: 600; }
  .choice input { width: auto; margin-top: 0.15rem; flex: none; }
  #backends.locked { opacity: 0.6; pointer-events: none; }
  .hidden { display: none; }
</style>
</head>
<body>
<div id="app">
  <h1>Echo Intelligence — First-time setup</h1>
  <p>Enter your API keys once. They're saved to your user profile so you won't need to enter them again.</p>
  <label for="deepgram">Deepgram API key (<a href="https://console.deepgram.com" target="_blank">console.deepgram.com</a>)</label>
  <input id="deepgram" type="password" autocomplete="off" />
  ${BACKEND_CHOICES}
  <div id="anthropic-field" class="hidden">
    <label for="anthropic">Anthropic API key (<a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>)</label>
    <input id="anthropic" type="password" autocomplete="off" />
  </div>
  <div id="gemini-field" class="hidden">
    <label for="gemini">Google Gemini API key (<a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>)</label>
    <input id="gemini" type="password" autocomplete="off" />
  </div>
  <button id="save-btn">Save and continue</button>
  <div id="message"></div>
</div>
<script>
  const saveBtn = document.getElementById("save-btn");
  const messageEl = document.getElementById("message");
  const backendsEl = document.getElementById("backends");
  const lockedByEnv = ${BACKEND_LOCKED_BY_ENV};

  function selectedBackend() {
    const checked = document.querySelector('input[name="backend"]:checked');
    return checked ? checked.value : "anthropic";
  }

  // Only show the key field for the backend that actually needs one, so the operator
  // is never asked for a key they don't have to have.
  function syncFields() {
    const backend = selectedBackend();
    document.getElementById("anthropic-field").classList.toggle("hidden", backend !== "anthropic");
    document.getElementById("gemini-field").classList.toggle("hidden", backend !== "gemini");
  }

  const initial = document.querySelector('input[name="backend"][value="${INITIAL_BACKEND}"]');
  if (initial) initial.checked = true;
  if (lockedByEnv) backendsEl.classList.add("locked");
  backendsEl.addEventListener("change", syncFields);
  syncFields();

  saveBtn.addEventListener("click", async () => {
    const deepgramApiKey = document.getElementById("deepgram").value.trim();
    const anthropicApiKey = document.getElementById("anthropic").value.trim();
    const geminiApiKey = document.getElementById("gemini").value.trim();
    saveBtn.disabled = true;
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deepgramApiKey, anthropicApiKey, geminiApiKey, detectorBackend: selectedBackend() }),
    });
    const body = await res.json();
    if (res.ok) {
      messageEl.textContent = "Saved — Echo Intelligence is starting. The operator page will open in a moment; you can close this tab.";
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

// Continue into the live server by re-exec'ing a *fresh* process rather than
// carrying on in this one.
//
// Not because of the require-time key capture this file's header used to warn
// about — both cloud fallbacks now read their key at call time, so that specific
// landmine is closed. The reason is that main() (scripts/live-demo.js) owns a
// one-time boot sequence the setup process has already skipped past: threshold
// calibration, the three suggestion miners, then api-server + presentation
// wiring. Re-running the entry point performs all of it in the right order with
// the keys already hydrated by config.loadConfig(), instead of duplicating that
// branch logic here and coupling this file to the entry script. It also matches
// the restart contract Settings already exposes (restartRequired), and is immune
// to any module that caches config at require-time.
//
// process.argv.slice(1) replays this exact launch: in dev that's the live-demo.js
// path arg; in a packaged SEA build there is no script arg (the script is embedded)
// and re-running process.execPath re-runs it. stdio is inherited and the child is
// NOT detached — on POSIX it outlives us via reparenting, and on Windows keeping it
// on the same console (rather than spawning a second window) means the one console
// the double-click opened stays alive and "close the window to quit" still works.
function relaunchIntoLiveServer(server) {
  const { spawn } = require("child_process");
  let relaunched = false;
  const relaunch = () => {
    if (relaunched) return;
    relaunched = true;
    spawn(process.execPath, process.argv.slice(1), { stdio: "inherit" });
    process.exit(0);
  };
  // Spawn only once the listening socket is released, so the child can rebind the
  // port; the timeout is a safety net in case a lingering socket stalls close().
  server.close(relaunch);
  setTimeout(relaunch, 2000);
}

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
          const { deepgramApiKey, anthropicApiKey, geminiApiKey, detectorBackend } = JSON.parse(raw);
          if (!deepgramApiKey) throw new Error("Deepgram key is required.");

          // DETECTOR_BACKEND in the environment outranks a saved choice, so don't
          // persist one that would never be read back.
          const backend = BACKEND_LOCKED_BY_ENV ? config.getDetectorBackend() : detectorBackend;
          if (!config.DETECTOR_BACKENDS.includes(backend)) throw new Error("Choose a scripture detection option.");
          if (backend === "anthropic" && !anthropicApiKey) throw new Error("An Anthropic API key is required for that option.");
          if (backend === "gemini" && !geminiApiKey) throw new Error("A Google Gemini API key is required for that option.");

          // Validated first, then written — a failed submit must not leave a persisted
          // backend whose key never made it to disk.
          if (!BACKEND_LOCKED_BY_ENV) config.setDetectorBackend(backend);
          config.saveConfig({ deepgramApiKey, anthropicApiKey, geminiApiKey });
          // Connection: close so the browser drops its keep-alive socket right after
          // this response — otherwise server.close() below waits out the idle-socket
          // timeout before the port is released and the child can rebind it.
          res.writeHead(200, { "Content-Type": "application/json", "Connection": "close" });
          res.end(JSON.stringify({ ok: true }));
          console.log("\nKeys saved — starting Echo Intelligence...");
          relaunchIntoLiveServer(server);
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
    // Same auto-open as the live server (see scripts/live-demo.js): a packaged
    // double-click launch shows only a console, so open the setup page for the
    // volunteer. paths/open-browser pull in none of the require-at-load clients
    // this file is careful to avoid (see header), so they're safe to require here.
    const { isPackagedBuild } = require("../paths");
    if (isPackagedBuild()) require("../open-browser").openBrowser(`http://localhost:${port}/`);
  });

  return server;
}

module.exports = { start };
