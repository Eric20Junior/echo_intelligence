# Echo Intelligence — MVP Roadmap

CTO-level roadmap from project start to a working MVP. Status reflects actual repo state, not aspirational planning.

**Repo layout (as of Phase 8)**: the app is now two sibling folders — `backend/` (everything described in Phases 0-7 below: `lib/`, `scripts/`, `data/`, `test/`, the old `overlay/` static pages) and `frontend/` (Next.js/TypeScript/Tailwind, Phase 8). All relative paths in the phase write-ups below (`lib/...`, `data/...`, `overlay/...`, `npm test`, `npm run live`) are relative to `backend/`, not the repo root. This split happened once a second, real half of the product (the frontend) existed — see Phase 8 for why.

---

## Phase 0 — Foundations ✅ Done

Architecture design, scripture-detection approach settled (regex-first + LLM-fallback, precision-over-recall, confidence-gated). See `docs/scripture-detection-design.md`.

## Phase 1 — Detection pipeline (the hard part) ✅ Done

Canonical book/verse table, alias table (primary + STT-variant tiers), normalizer, regex extractor, validator, LLM fallback (Claude Haiku 4.5), local KJV verse-text resolution, session/log table. Tested against a 27-case corpus plus real garbled audio.

- `data/books.js`, `data/book-aliases.js` — canonical + alias tables
- `lib/normalize.js`, `lib/extract.js`, `lib/validate.js` — regex pipeline
- `lib/llm-fallback.js`, `lib/detect.js` — LLM fallback + orchestration
- `lib/resolve.js`, `data/verses.db` — verse text lookup (public-domain KJV)
- `lib/log.js`, `data/log.db` — detection logging
- `test/corpus.js`, `test/run.js` — 27-case regression suite (`npm test`)

## Phase 2 — STT integration ✅ Done, field-validated

- Done: prerecorded file transcription via Deepgram (nova-3 → nova-2 fallback), local Whisper as a comparison engine.
- Done: **live streaming** STT — `scripts/live-demo.js` spawns `arecord`, streams raw PCM directly to Deepgram's live WebSocket endpoint (nova-3 + book-name keyterm boosting), and feeds each `is_final` utterance into the existing `detectReference()` pipeline. Talks to Deepgram via the raw `ws` package rather than `@deepgram/sdk`'s `listen.v1.connect()` wrapper, which was found to hang silently (no open/error/close event, ever) in this environment — the SDK is still used for file-based transcription in `stt-spike.js`, just not for the live socket.
- Fixed a require-order bug (in both `live-demo.js` and `stt-spike.js`) where `lib/llm-fallback.js` constructed its Anthropic client at module-load time, before `dotenv.config()` had run — silently broke the LLM-fallback path specifically, which is why the 27-case regex-only test suite never caught it.
- Verified live end-to-end with real speech, not just the synthetic corpus: clean canonical references ("Genesis chapter one verse one"), chapter-only references ("Psalm 23"), and a stuttered/doubled utterance ("Psalm Psalm 23") that correctly downgraded to `suggest` instead of misfiring — the confidence gate from design doc §5 is behaving as designed against real mic input, not just the test corpus.

## Phase 3 — Event pipeline ✅ Done (web-first, no Electron)

Stage separation is done via plain modules with callback/promise APIs (`lib/mic-source.js`, `lib/stt-source.js`, `lib/session.js`, `lib/presentation.js`) rather than a literal `EventEmitter` bus — a CTO review of the initial design judged pub/sub as overengineering for a single Node process with no multi-process need, and plain function composition keeps stack traces and error propagation intact. `scripts/live-demo.js` is now a thin bootstrap; mic/STT no longer start at process boot, only when the operator explicitly starts a session (Phase 4 UI). Mic device selection is implemented: `lib/mic-source.js#listDevices()` parses `arecord -l`, exposed via `GET /api/devices`, picked by the operator before starting. Per web-first decision: no Electron app — reused the existing Node + WebSocket pattern.

## Phase 4 — Operator UI ✅ Done

`overlay/operator.html` + new routes on `lib/overlay-server.js`: device picker, Start/Stop controls, a live feed of auto-displayed verses, and a suggestion queue with Confirm/Reject buttons. `lib/presentation.js` now correctly enforces design doc §5: `suggest`-status detections go **only** to the operator queue (`lib/suggestion-queue.js`), never straight to the overlay — fixing a real violation in the old code, which pushed `suggest` to the projector with just a CSS badge. Suggestions older than 3 minutes are flagged `stale` (visual only, not blocking). The operator WebSocket sends a full snapshot (pending queue + recent auto-display history) on every connect, so a mid-service page reload doesn't lose state. `POST /api/start` is idempotent — a second call while a session is active returns the existing session instead of spawning a second `arecord`. The operator page also embeds an `<iframe>` live preview of the actual overlay page, so one browser tab is enough during setup/testing instead of two.

**Field-validated 2026-07-02** with real (messy, mid-sentence) sermon-style speech: two clean references correctly auto-displayed (John 3:16, Genesis 1:1), four ambiguous/garbled utterances correctly stayed in the operator's pending queue only (never reached the overlay) until manually confirmed, and the confirm action correctly pushed the approved suggestion through to the overlay.

Deferred: no persistence of the suggestion queue across a full server restart (in-memory only — a process crash mid-service loses pending suggestions, though every detection is still recorded in `data/log.db` via the unchanged `lib/log.js`), no dedicated always-on-top/kiosk output window (still Phase 6 packaging).

## Phase 4.5 — Reading mode ✅ Done

Your own design doc explicitly scoped anaphoric/implicit references ("the next verse", "go back to verse 10") **out of V1** because full conversational-state tracking is hard. Prior art ([openbezal/rhema](https://github.com/openbezal/rhema), see below) shows a cheaper middle ground: a "reading mode" state machine that locks onto a book/chapter once it's explicitly mentioned, then handles bare navigation commands ("next chapter", "chapter 5", "verse 10") without re-parsing a full reference each time — a bounded state machine, not general anaphora resolution.

Built as `lib/reading-mode.js`, wired into `lib/detect.js` as a new stage between the existing regex pass and the LLM fallback. Motivated by a real gap found in the 2026-07-02 field test: Deepgram's endpointing split "Proverbs 22 verse five" into two separate utterances ("chapter 22?" and "Verse five."), both logged `no_match` at the time since neither has a book-name anchor — reading mode now catches exactly this once a book has been locked in.

A CTO review pushed back on two safety points, both adopted: state only **locks** on a confirmed `auto_display` result or explicit operator approval of a `suggest` (`lib/presentation.js#approve` now calls `readingMode.lock`) — never on an unconfirmed guess, so error can't silently compound with zero book-name safety net downstream. And reading-mode-originated candidates are capped in `lib/validate.js#scoreConfidence` below `CONFIDENCE_THRESHOLD` entirely (no verseStart bonus) — every nav match routes through the operator queue for V1, "cheap insurance" given there's no book-name anchor in the utterance itself, only the app's own state to trust. A locked state also expires after 8 minutes of no new lock (`lib/reading-mode.js`'s `IDLE_TIMEOUT_MS`), so a book mentioned early in a service can't silently drive unrelated navigation much later (e.g. during announcements).

**Extended same day after a live test** (spoke "John chapter three verse sixteen" then "next verse"): Deepgram's endpointing fragmented "next verse" down to a bare "Next," / "Next." across several separate utterances, never the full phrase — `tryNavigate` originally only matched exact `"next verse"`/`"next chapter"`. Added bare `"next"`/`"previous"` handling (advances the most granular locked unit — verse if one's set, otherwise the whole chapter) and a combined `"chapter N verse M"` pattern (restating both without the book name, another real fragment seen in the same test: "chapter three, verse 16."). 12/12 reading-mode test steps pass, including both real fragmentation cases. Separately, that same live test also surfaced an STT mishearing ("John 3:16" transcribed as "John ten sixteen," then correctly auto-displayed as the — wrong but structurally valid — John 10:16) — not a detection-layer bug, ties back to the still-open mic-gain/clipping issue in "Known issues" above.

Tested via a new stateful harness (`test/reading-mode-corpus.js` + `test/reading-mode-run.js`, run by `npm test` alongside the existing 27-case corpus) since the existing `parseUtterance` test harness is stateless and doesn't fit — includes the real split-utterance case above, a chained "next verse" sequence through a simulated operator-approve, and a chapter-overflow case confirming the existing canonical-table bound check catches it with no special-casing needed.

## Phase 5 — Projector/presentation output ✅ Done

- `lib/overlay-server.js` + `overlay/index.html` — a local HTTP+WebSocket server serving a dark, full-screen verse overlay page, broadcasting detections in real time. This is the "magic moment" from the design doc, confirmed working live: real speech → correct verse text appearing on the overlay, not just a synthetic test.
- **Fullscreen/kiosk**: `overlay/index.html` has a "Go Fullscreen" button (`requestFullscreen()` on user gesture — no Electron needed for this deployment: one operator, one controlled room, not an unattended public kiosk). If fullscreen drops (e.g. accidental Esc), the button reappears as "Click to resume fullscreen" — browsers require a fresh gesture to re-enter, so this can only prompt, not auto-recover. A `visibilitychange` listener logs a console warning if the page loses focus, as a debugging aid.
- **Second display**: `overlay/operator.html` has an "Open on second display" button — `window.open()` positioned at the boundary of the primary display (`left: screen.availWidth`), landing it on an extended secondary display for the standard single-projector setup. A named window, so repeat clicks refocus rather than duplicate. **Deliberately not** full N-monitor targeting via Chrome's Window Management API (`getScreenDetails()`) — that needs a second live-setup permission prompt for a case (3+ displays) that hasn't come up; scoped down per a CTO review, YAGNI until a venue actually needs it.
- **NDI broadcast output**: reframed as an operational note, not a code task — the NDI SDK is a native C library with no browser-JS path, and nothing in the field-validated deployment needs composited broadcast output yet (a physical screen is proven sufficient for V1). For whenever a venue needs NDI/live-production integration: capture `overlay/index.html` as an OBS Browser Source and use OBS's NDI-output plugin — zero new code required.

## Phase 6 — Packaging & real-world deployment 🟡 Partial — Linux verified end-to-end, Windows/macOS unverified

This line originally said "bundling the Electron app" — stale wording left over from before the web-first decision (Phase 3, reaffirmed at Phase 5); there is no Electron app. A CTO review confirmed 3-platform *distribution* is a different axis from the earlier web-first UI decision and doesn't reopen it — Electron would just be "bundle Chromium to make an installer," buying nothing since the frontend already works in any real browser.

**Cross-platform mic capture** — `lib/mic-source.js` no longer shells out to `arecord` (ALSA/Linux-only). It now uses `ffmpeg`, branching per `process.platform` (`alsa` on Linux, `dshow` on Windows, `avfoundation` on macOS), bundled via the `ffmpeg-static` npm package with a preference for a system-installed `ffmpeg` when present. That preference exists because `ffmpeg-static`'s precompiled Linux binary was found to bake in a mismatched ALSA plugin search path (fails with "cannot open shared library libasound_module_conf_pulse.so" even though the file exists, just at a different multiarch path) — a packaging quirk of the static build, confirmed by the system's own `ffmpeg` capturing the identical device without issue. Public API unchanged (`listDevices()`/`start()`), so `lib/session.js` needed zero changes. **Verified end-to-end on this Linux machine** with real speech through the full pipeline — signal quality matches the old `arecord` path exactly, no regression. Windows (`dshow`)/macOS (`avfoundation`) branches are written against ffmpeg's documented CLI interface but have not been run on those OSes.

**Non-technical API key setup** — `lib/config.js` + `lib/setup-server.js`: a packaged app has no `.env` file for an operator to hand-edit, so on first run (if keys are missing) a minimal standalone setup page collects both API keys and saves them to `~/.echo-intelligence/config.json`. Deliberately a **separate, minimal HTTP server**, not a route added to `lib/overlay-server.js` — it must not `require()` anything that transitively loads `lib/llm-fallback.js`, which constructs its Anthropic client at module-load time from `process.env.ANTHROPIC_API_KEY` (the exact require-order landmine documented back in Phase 2 — requiring it before a key is set, then setting the key afterward in the same process, wouldn't fix a client already constructed with `undefined`). `.env` still takes priority for the existing developer workflow. Verified end-to-end: missing-key detection, page serving, validation, persistence, and `.env` precedence all tested directly; also confirmed live through the actual packaged executable (see below) with no `.env` present, correctly landing on the setup page instead of crashing.

**Packaging build, real and tested on Linux** — `scripts/package.js` (run via `npm run package`) bundles the whole app into one file with `esbuild` (externalizing only `better-sqlite3`, the one native dependency) and produces a Node 20 **Single Executable Application**. Two real, non-obvious technical risks were found and resolved, not assumed away:
1. **Bundling collapses every file's own `__dirname` to one shared value** (the executable's own directory) — verified directly with an isolated nested-module test before touching the real codebase. This silently breaks the old pattern of `path.join(__dirname, "..", "data", ...)` scattered across `lib/resolve.js`, `lib/log.js`, `lib/overlay-server.js`, and `scripts/live-demo.js`, each of which assumed its *own* file location. Fixed by centralizing all app-relative path resolution into one new file, `lib/paths.js`, computing the app root once; the distribution layout ships the executable in its own `bin/` subfolder with `data/`, `overlay/`, and `bin/node_modules/` as siblings, matching that single computation.
2. **A SEA-embedded script's `require()` only loads Node built-ins — not any npm package, not just native ones.** `better-sqlite3` (and its own transitive deps, `bindings` and `file-uri-to-path`) now load via `require("module").createRequire(__filename)(...)` (added as `lib/paths.js#requireNative`), which works identically in normal unbundled dev mode too — confirmed via `npm test` after the change, zero dev-workflow regression.

`npm run package` was run for real on this machine, producing an actual executable that was then run standalone (not just reviewed as code): it correctly serves both HTTP pages, lists real mic devices, starts a real live-capture session with real speech, and correctly falls into the first-run setup flow when no keys are present. This is the strongest verification available in this session; a `.github/workflows/package.yml` 3-OS matrix runs the identical `npm run package` script on `windows-latest`/`macos-latest`/`ubuntu-latest` and uploads each `dist/` as a build artifact, but **has not itself been executed yet** — the Windows/macOS legs are unverified until that workflow actually runs and someone smoke-tests the resulting executables on real hardware.

**Deliberately not built**: signed/notarized installers. `scripts/package.js` handles the macOS-specific ad-hoc code-signing step needed just to let an unsigned binary launch at all (`codesign --remove-signature` before injection, `codesign --sign -` after), but a real Apple Developer certificate (for notarization, removing the Gatekeeper warning entirely) and a Windows code-signing certificate (removing the SmartScreen warning) are both credential/business prerequisites this session doesn't have — `docs/install.md` documents the resulting one-time "right-click → Open" / "More info → Run anyway" workaround as the honest current state, rather than pretending those warnings don't exist.

**Translation licensing**: confirmed — the KJV is public domain, no licensing action needed. `data/verses.db` and the (unused-at-runtime, safe to ignore) `kjv` npm dependency are both KJV-sourced.

**Non-technical install docs**: `docs/install.md` — download, run from the `bin/` folder, enter two API keys once, pick a mic, go.

## Phase 7 — Field testing & tuning loop ⬜ Not started, but scaffolded

The log table (`data/log.db`) is built specifically to support this: run it in a real service, mine the log for real false positives/negatives, feed that back into the alias table and confidence thresholds.

## Phase 8 — Frontend + Express backend split 🟡 In progress

**Repo restructuring**: moved everything from Phases 0-7 into `backend/` (verified safe — `lib/paths.js#APP_ROOT` is computed as `__dirname/..`, so the whole tree could move down one level with zero path changes; `npm test` re-confirmed 27/27 + 12/12 immediately after the move). `frontend/` sits alongside it as its own sibling folder — deliberately flat, no monorepo/workspace tooling (`apps/`+`packages/`), per a CTO review: YAGNI until an actual second product exists on top of this infrastructure, which hasn't happened yet.

**Frontend**: new Next.js (App Router) + TypeScript + Tailwind v4 app in `frontend/`. Talks to the unchanged backend WS/REST contract over `localhost:8787` (configurable via `NEXT_PUBLIC_BACKEND_HOST`) — CORS was added to `lib/overlay-server.js`'s `/api/*` routes since browser `fetch()` (unlike WebSocket) enforces it cross-origin. `frontend/app/page.tsx` (root) is now the operator control panel — moved from `/operator` so the operator doesn't need to type a path. `frontend/app/overlay/page.tsx` is the projector page. A design system was pulled from a Claude Design project (`nextjs/` folder in that project — tokens, Tailwind theme, typed components) and applied: warm-black/gold "candlelit instrument panel" look, `components/ui/*` (Button, Card, StatusBadge, LiveIndicator, SuggestionCard, FeedItem, VerseDisplay, IdleScreen, Toast).

Important divergence from the design mock: the mock (`ui_kits/operator/index.html`, an interactive HTML click-through, not connected to any real backend) includes several features the backend didn't yet support — confidence %, translation picker, Plan/History/Settings tabs, live transcript ribbon, audio meter, ±1 verse nudge, multi-operator lock. Rather than build decorative UI for data that doesn't exist, Phase 8's first frontend pass only implements what the real backend contract supports (mic start/stop, pending-suggestion confirm/reject, live preview, recently-displayed feed) — the rest is being built backend-first, feature by feature, per the sequencing below.

**Backend: Express migration** — `lib/overlay-server.js` ported from plain `http.createServer` to an Express app (same routes, same WS-upgrade attachment via `ws`'s `{server}` option, zero contract change; `npm test` + a live CORS/status/devices smoke check confirmed no regression). Done as its own step, before any new feature work, per CTO guidance: every new feature below adds routes/handlers, and writing them once against Express beats migrating later.

**CTO-agreed sequencing for the rest of the mock buildout** (backend work, in order):
1. Expose what already exists cheaply: confidence score (already computed in `lib/validate.js#scoreConfidence`, currently stripped before broadcast), manual verse-entry endpoint, ±1 range nudge, confirm-before-live/collapse-repeats settings flags.
2. History tab — read-only query layer over the existing `data/log.db` (already logs every detection via `lib/log.js`), no new storage.
3. Plan tab — new in-memory (not persisted) pre-service passage list + service-section state.
4. Audio meter — `lib/mic-source.js` computing/broadcasting RMS level periodically.
5. Multi-operator lock — first-connection-gets-control role tracking at the WS layer.

**Explicitly not building, flagged rather than silently skipped**: ESV/NIV translation text — unlike the KJV (public domain, already embedded), these require a commercial license; the picker UI can exist but only KJV actually ships until licensing is secured. **Rehearsal mode** (replay a recorded service through the pipeline) — genuinely new audio-replay infrastructure unrelated to the live path, recommended as a later addition once the live operator workflow above is fully built and re-validated, not bundled into this pass just because it's in the mock.

---

## Reference: openbezal/rhema (prior art)

[Rhema](https://github.com/openbezal/rhema) (MIT-licensed) solves the same problem — live sermon audio → verse detection → broadcast overlay — with a much larger Tauri v2 + Rust + React stack (7 crates: audio, STT, bible, detection, broadcast, api, notes). We are **not** porting its architecture, but it's a useful roadmap cross-check:

| Rhema crate | Purpose | Our equivalent |
|---|---|---|
| `rhema-audio` | device enumeration, capture, VAD | `arecord` spawn in `live-demo.js` — no device picker, no VAD |
| `rhema-stt` | local Whisper + Deepgram WS/REST | Deepgram live only |
| `rhema-bible` | SQLite + FTS5, cross-references | `lib/resolve.js` + `data/verses.db` — no FTS, no cross-refs |
| `rhema-detection` | direct (Aho-Corasick+fuzzy) + semantic (ONNX embeddings) + quotation matching + sentence buffer + reading mode + sermon context | `lib/parse.js`/`extract.js`/`validate.js`/`llm-fallback.js` — regex+LLM only |
| `rhema-broadcast` | NDI FFI output | `overlay/index.html` browser page — no NDI |
| `rhema-api` | Tauri command/event layer | none — scripts call each other directly, no shell yet |

Features intentionally **not** adopted (deferred beyond MVP, if ever): semantic/embedding-based detection, quotation matching, theme designer, NDI broadcast output, remote control (OSC/HTTP), multi-translation voice switching. Reading mode (Phase 4.5 above) is the one feature worth pulling forward.

---

## Known issues

- **Resolved 2026-07-02: mic capture gain, not a code bug, and not a language issue.** Originally surfaced as "phone-speaker sermon audio doesn't get picked up" and later as generally degraded live accuracy (an STT mishearing "John 3:16" as "John ten sixteen," which the detection pipeline correctly auto-displayed since it's a structurally valid — just wrong — reference). Root cause: ALSA capture gain (`amixer sget Capture`) was found at **17%** (too quiet — peak amplitude 4.4% of full scale, RMS ~198/32768, below what Deepgram's speech detector needs) at one point, then later drifted to **126%** (clipping — peak pegged at 100% full scale with several percent of samples saturated) with no code change in between; cause of the drift itself was never identified (no PipeWire filter-chain/AGC was active — confirmed via `wpctl status`'s empty `Filters:` section — so it wasn't a background auto-gain process; possibly an accidental system-tray volume adjustment). Fixed by setting the level explicitly via `pactl set-source-volume alsa_input.pci-0000_00_1b.0.analog-stereo 55%` (the PipeWire-native source name, confirmed as the authoritative layer over raw `amixer` since PipeWire owns this hardware) rather than `amixer` alone. Verified stable afterward (`amixer` and `pactl` report matching 55%, no further drift observed) and confirmed via live retest — "John three sixteen." correctly auto-displayed as JHN 3:16. If mic issues recur: check `amixer sget Capture` and `pactl get-source-volume <source-name>` (find the real source via `pactl list sources`) agree and are in a sane range (not near 0%, not clipping near 100%+) before assuming it's a detection or STT-language bug.
- **Still open: phone-speaker-into-mic playback specifically** (acoustic speaker-to-mic coupling, as opposed to direct speech) hasn't been retested since the gain fix above. If still unreliable, prefer a direct cable (phone headphone-out → mic-in) over acoustic coupling, which is inherently lossy.

## Recommended sequencing

Phases 1-4 are done — detection pipeline, live streaming STT, the event pipeline, and the operator confirm UI all work end-to-end, field-tested against real (messy, code-switched) sermon-style speech via direct mic input. Phase 5 has a minimal browser-based version, also field-tested. Next up per the CTO-agreed sequencing: **Phase 4.5 (reading mode)** is the recommended next feature — cheap relative to Rhema's semantic search, and it directly extends scope the design doc deliberately deferred, motivated by real observed behavior (the pastor in the field test circled back to a passage with a bare "that's it, Matthew 28:19" rather than a clean full reference). Phase 5's remaining gaps (kiosk/fullscreen window, multi-monitor, NDI) are deployment polish, better done closer to an actual on-site install — hold off on those and on Phase 6 until closer to real deployment.

**Where we are right now**: Phases 1-4 shipped and field-validated with real mic input (see Phase 3/4 sections above for detail). While testing further, found the known mic-gain issue above (phone-speaker-into-mic playback, not a code bug) — paused mid-diagnosis with the fix identified but not yet re-verified. Next open work: either resume verifying the mic-gain fix, or start Phase 4.5 (reading mode) — both are valid next steps, neither started.
