# Echo Intelligence

Live sermon scripture detection: a preacher says a Bible reference out loud, it's
picked up by a microphone, transcribed, matched against the KJV, and pushed to a
projector overlay for the congregation — all in close to real time.

```
mic → speech-to-text → reference detection → operator confirm/reject → projector overlay
```

## Features

- **Offline-first detection**: a regex pass handles ~85–90% of spoken references
  instantly, with an on-device LLM fallback (Qwen2.5, via `node-llama-cpp`) for
  STT-garbled cases — no account or API key required by default.
- **Reading mode**: once a book/chapter is confirmed, bare follow-ups like "next
  verse" or "chapter 5" resolve against it without needing a full reference each
  time.
- **Content-based lookup**: paraphrases like "the verse about training up a
  child" are matched against verse text itself (KJV, full-text search), not just
  literal references.
- **Operator confirm/reject queue**: low-confidence detections never go straight
  to the projector — an operator approves or rejects them first.
- **Learns over time, with a human in the loop**: mishears that keep recurring
  (a mispronounced book name, a recurring paraphrase, a navigation phrasing the
  regex misses) are mined from session logs into suggestions an operator
  explicitly approves — nothing is ever auto-applied silently.
- **Speech-to-text**: Deepgram (cloud, default) or a fully local Whisper option
  (`STT_BACKEND=local`) for fully offline operation, hardware permitting.
- **Single self-contained install**: packaged as one executable per OS (Node
  Single Executable Application) with no separate services to run.

## Install

No Node.js, git, or anything else needs to be installed first.

**macOS/Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://raw.githubusercontent.com/Eric20Junior/echo_intelligence/main/install.ps1 -useb | iex
```

See [docs/install.md](docs/install.md) for first-run setup (API key, picking a
microphone) and platform-specific notes (unsigned-binary warnings on
Windows/macOS). All three OSes are built and verified by
[.github/workflows/package.yml](.github/workflows/package.yml) on every
tagged release.

## Architecture

Two sibling folders:

- **`backend/`** — Node.js + Express + WebSocket server. Owns mic capture, STT,
  the detection pipeline, the operator/overlay WebSocket protocol, and all
  `/api/*` REST routes. See [docs/scripture-detection-design.md](docs/scripture-detection-design.md)
  for the detection pipeline's design.
- **`frontend/`** — Next.js/TypeScript/Tailwind UI: an operator control panel
  (`/`) and a projector overlay page (`/overlay`), talking to the backend over
  REST + WebSocket at `localhost:8787`. Built as a static export and served by
  the backend in packaged installs — no separate frontend process at runtime.

One process, one port (`8787`), no Electron — see `docs/roadmap.md` for why.

## Development

```bash
# backend
cd backend
npm install
npm test        # detection corpus + reading-mode corpus
npm run live     # starts the backend on :8787

# frontend (separate terminal)
cd frontend
npm install
npm run dev      # starts on :3000, talks to the backend at :8787
```

To test from another device (e.g. a phone as the projector display) on the
same network, start the frontend with `NEXT_PUBLIC_BACKEND_HOST` set to your
machine's LAN IP, then open `http://<lan-ip>:3000` from that device:

```bash
NEXT_PUBLIC_BACKEND_HOST=192.168.x.x:8787 npm run dev
```

Useful environment variables (backend `.env`, see `backend/lib/config.js`):

| Variable | Values | Default | Purpose |
|---|---|---|---|
| `DEEPGRAM_API_KEY` | — | — | Required unless `STT_BACKEND=local` |
| `STT_BACKEND` | `deepgram` \| `local` | `deepgram` | Speech-to-text engine |
| `DETECTOR_BACKEND` | `local` \| `anthropic` | `local` | Reference-extraction fallback (local Qwen2.5 vs. a rollback path to Claude Haiku — faster, but needs an API key and internet) |
| `ANTHROPIC_API_KEY` | — | — | Only needed if `DETECTOR_BACKEND=anthropic` |

Frontend (`frontend` `.env.local`):

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_HOST` | `localhost:8787` | Backend address the browser connects to — set this when accessing the frontend from a different device than the one running the backend |

## Packaging a release

```bash
cd backend
npm run package
```

Builds a standalone `backend/dist/` (executable + data + models + the built
frontend). `.github/workflows/package.yml` runs this on Linux/Windows/macOS and,
on a `v*` tag push, publishes zipped builds to a GitHub Release — the artifacts
`install.sh`/`install.ps1` download.

## Licensing

Displays the **King James Version (KJV)**, which is in the public domain — no
licensing action needed for the bundled verse text. Other translations
(ESV/NIV) require a commercial license and are not shipped.

## Status

Active development. See [docs/roadmap.md](docs/roadmap.md) for what's done,
what's in progress, and known issues.
