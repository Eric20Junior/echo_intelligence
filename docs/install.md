# Installing Echo Intelligence

## Licensing

Echo Intelligence displays the **King James Version (KJV)**, which is in the public domain — no licensing action is required to use or distribute the bundled verse text (`data/verses.db`).

## Installing

### Installer (Windows and macOS) — recommended

Download from the [latest release](https://github.com/Eric20Junior/echo_intelligence/releases/latest), open it, and follow the prompts. No terminal, no Node.js, nothing else to install first.

- **Windows**: `echo-intelligence-<version>-windows-setup.exe`. Installs per-user (no administrator password needed) and adds a Start menu and desktop shortcut. Installing again over an existing copy upgrades it in place.
- **macOS**: `echo-intelligence-<version>-macos.dmg`. Open it and drag **Echo Intelligence** into your Applications folder.

Both installers are unsigned, so the OS warns before it will open them — see [Known platform caveats](#known-platform-caveats) below for the exact click-through, which you only have to do once.

Your settings and learned data live in `~/.echo-intelligence` (`%USERPROFILE%\.echo-intelligence` on Windows), outside the installed app — so upgrading or uninstalling never touches them.

### One-line script (all three OSes)

Open a terminal and run the line for your OS. No Node.js, git, or anything else needs to be installed first — this downloads the latest prebuilt release and unzips it to `~/echo-intelligence` (`%USERPROFILE%\echo-intelligence` on Windows). This is the only option on Linux.

**macOS/Linux** (Terminal):
```
curl -fsSL https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.sh | bash
```

**Windows** (requires Windows 10 or later; PowerShell — not Command Prompt/cmd.exe):
```
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; iwr https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.ps1 -useb | iex
```

Prefer to do it by hand instead? Download the `echo-intelligence-<your-os>.zip` from the [latest release](https://github.com/Eric20Junior/echo_intelligence/releases/latest) and unzip it anywhere yourself.

## First run

1. Start it:
   - **Installed with the installer** — use the **Echo Intelligence** shortcut (Windows: Start menu or desktop; macOS: Applications folder or Launchpad). A terminal window opens and stays open while the app runs; closing that window is how you stop the app. If no shortcut appeared, open the folder it installed to and run `echo-intelligence` from inside `bin`.
   - **Installed with the one-line script** — open the `bin` folder inside where it was installed and run `echo-intelligence` (double-click on Windows/macOS, or `./echo-intelligence` in a terminal on Linux).
2. The first time it runs, a setup page opens in your browser by itself. It asks for two things:
   - **Deepgram** (for speech-to-text) — get a key free at [console.deepgram.com](https://console.deepgram.com)
   - **Scripture detection** — used only when the built-in word matching can't identify a spoken reference. Pick one: **Anthropic Claude** (most accurate; paid, roughly a cent per service), **Google Gemini** (free tier, no card required), or **On this computer** (no internet or key needed once set up, but downloads about 470MB the first time and is slow on older machines). Enter the key for whichever you pick.
3. Click **Save and continue**. The app restarts itself and opens the operator control panel — you don't need to close anything or start it again. Your keys are remembered from now on (saved to a config file in your user profile, not inside the app folder).
4. On the operator control panel, pick your microphone from the dropdown and click **Start Listening**.
5. Open `http://localhost:8787/overlay` on the projector/screen the congregation sees, and click **Go Fullscreen**.

## Using the overlay in OBS (livestreaming)

To composite the detected verse over your camera/stage feed in OBS instead of (or alongside) a projector, add a **Browser Source** pointed at:

```
http://localhost:8787/overlay?transparent=1&position=br&size=medium
```

- `transparent=1` drops the black background and shows the verse on a small translucent card instead, so it composites over your existing video layers.
- `position` — corner to anchor the card in: `tl`, `tr`, `bl` (default-ish bottom-left), `br`, or `center`.
- `size` — `small`, `medium`, or `large`.

If a source reconnects after a network hiccup, the verse fades out after a few seconds rather than freezing on a stale reference — no manual refresh needed mid-stream.

## About the scripture-reference fallback

Most spoken references are parsed instantly and fully offline by a built-in regex pass. For the minority that STT garbles too badly for that (an unclear book name, for instance), the app falls back to whichever scripture-detection option you chose during setup.

If you chose **On this computer**, that fallback runs a small AI model (Qwen2.5) locally — no internet or account needed, but it downloads about 470MB the first time it's used, and it needs a CPU from roughly 2013 or later (specifically, one with AVX2 support) to run at a usable speed. On older or very low-power hardware it can take up to a minute per fallback case — slow, but it still only affects the operator's confirm/reject queue for the rare STT-garbled utterance, not the regex path that handles most references instantly.

## Known platform caveats

- **macOS**: nothing here is code-signed with an Apple Developer certificate, so Gatekeeper refuses the first launch. **Right-click** (or Control-click) **Echo Intelligence** in Applications, choose **Open**, then **Open** again in the dialog — once, ever. Plain double-clicking the first time shows a dead-end "cannot be opened" or "damaged" message with no Open button, because a file downloaded in a browser also carries a quarantine flag; the right-click path clears it. macOS 15+ instead sends you to **System Settings → Privacy & Security**, where an **Open Anyway** button appears after the failed attempt. Also expect a microphone prompt on first listen that says *Terminal* wants access rather than Echo Intelligence — that's how macOS attributes the request for a terminal-launched app; allow it. (A signed/notarized build is future work — it requires a paid Apple Developer account, which this project doesn't currently have.)
- **Windows**: requires **Windows 10 or later** — the app is packaged as a Node 22 single-executable, and Node.js itself has required Windows 10+ since Node 12, so it won't run (and `install.ps1` won't even complete) on Windows 7/8.1. It's also unsigned, so SmartScreen shows a blue "Windows protected your PC" screen for the installer: click **More info** → **Run anyway**. The installer itself needs no administrator password — it installs for the current user only.
- **Linux**: no special caveats found in testing; if microphone capture fails, confirm `ffmpeg` is installed system-wide (`ffmpeg -version`) — the app falls back to a bundled copy if not, but the system one is preferred since it's more reliably built against this machine's actual audio library layout.
- **Shortcuts on Windows and macOS**: creating the desktop and Start menu shortcut is best-effort and hasn't been confirmed on real hardware yet. If none appears after installing, the app is still fine — open the folder it installed to and run `echo-intelligence` from inside `bin`.
