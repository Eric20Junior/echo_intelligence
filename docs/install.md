# Installing Echo Intelligence

## Licensing

Echo Intelligence displays the **King James Version (KJV)**, which is in the public domain — no licensing action is required to use or distribute the bundled verse text (`data/verses.db`).

## Installing

Open a terminal and run the line for your OS. No Node.js, git, or anything else needs to be installed first — this downloads the latest prebuilt release (built by `.github/workflows/package.yml`; Windows and macOS builds have not yet been smoke-tested on real hardware — see `docs/roadmap.md`'s Phase 6 section) and unzips it to `~/echo-intelligence` (`%USERPROFILE%\echo-intelligence` on Windows).

**macOS/Linux** (Terminal):
```
curl -fsSL https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.sh | bash
```

**Windows** (PowerShell):
```
iwr https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.ps1 -useb | iex
```

Prefer to do it by hand instead? Download the `echo-intelligence-<your-os>.zip` from the [latest release](https://github.com/Eric20Junior/echo_intelligence/releases/latest) and unzip it anywhere yourself.

## First run

1. Open the `bin` folder inside where it was installed, and run `echo-intelligence` (double-click on Windows/macOS, or `./echo-intelligence` in a terminal on Linux).
2. The first time it runs, a page opens asking for an API key:
   - **Deepgram** (for speech-to-text) — get one free at [console.deepgram.com](https://console.deepgram.com)
3. Enter it, click **Save and continue**, then close that window and run `echo-intelligence` again — it remembers your key from now on (saved to a config file in your user profile, not inside the app folder).
4. Open `http://localhost:8787/` in your browser — this is the operator control panel. Pick your microphone from the dropdown and click **Start Listening**.
5. Open `http://localhost:8787/overlay` on the projector/screen the congregation sees, and click **Go Fullscreen**.

## About the scripture-reference fallback

Most spoken references are parsed instantly and fully offline by a built-in regex pass. For the minority that STT garbles too badly for that (an unclear book name, for instance), the app runs a small local AI model (Qwen2.5, bundled with the app) to fill in the gap — still fully offline, no account or API key needed.

That local fallback needs a CPU from roughly 2013 or later (specifically, one with AVX2 support) to run at a usable speed. On older or very low-power hardware it can take up to a minute per fallback case — slow, but it still only affects the operator's confirm/reject queue for the rare STT-garbled utterance, not the regex path that handles most references instantly.

(Developers comparing accuracy against the old cloud-based detector can set `DETECTOR_BACKEND=anthropic` and supply an Anthropic API key — this is a rollback/testing path, not something a normal install needs.)

## Known platform caveats

- **macOS**: the app isn't code-signed with an Apple Developer certificate, so Gatekeeper will likely refuse to open it or show an "unidentified developer" warning. Right-click the executable and choose "Open" to bypass this once. (A signed/notarized build is future work — it requires an Apple Developer account, which this project doesn't currently have.)
- **Windows**: similarly unsigned — Windows SmartScreen may warn before running it. Click "More info" → "Run anyway."
- **Linux**: no special caveats found in testing; if microphone capture fails, confirm `ffmpeg` is installed system-wide (`ffmpeg -version`) — the app falls back to a bundled copy if not, but the system one is preferred since it's more reliably built against this machine's actual audio library layout (see `docs/roadmap.md`'s Phase 6 notes for why).
