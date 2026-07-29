// Single source of truth for resolving app-relative paths (data files, overlay
// HTML, .env). Needed for packaging (roadmap Phase 6): bundling every file into
// one script for a Node SEA executable collapses each file's own __dirname to
// the same shared value (verified directly — see docs/roadmap.md), which
// silently breaks the old pattern of scattering `path.join(__dirname, "..", ...)`
// across multiple files, each assuming its own location. Centralizing it here
// means only this one file's relative-depth assumption needs to be correct.
//
// Two roots, not one. resolvePath() points at the installed app's own files,
// which a native installer puts somewhere read-only; resolveWritablePath()/
// resolveWritableDir() point at the operator's data folder. Anything created or
// modified at runtime must use the latter, or the app breaks the moment it's
// installed anywhere but a folder the user happens to own.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const APP_ROOT = path.join(__dirname, "..");

function resolvePath(...segments) {
  return path.join(APP_ROOT, ...segments);
}

// Everything the app writes for one operator: the detection log DB, the local
// LLM's downloaded .gguf, the Whisper model cache, and (via lib/config.js)
// config.json. Kept as one directory so there's a single answer to "where is my
// data" and a single thing to delete on uninstall.
//
// A dotfolder in the home directory rather than %LOCALAPPDATA%/Application
// Support: lib/config.js already put config.json here before packaging existed,
// and splitting the DB off into a per-OS location would leave an operator's data
// in two places for no gain the operator can see.
const USER_DATA_ROOT = process.env.ECHO_DATA_DIR
  ? path.resolve(process.env.ECHO_DATA_DIR)
  : path.join(os.homedir(), ".echo-intelligence");

// True only in a real packaged install, false under `npm run live` dev. The
// frontend static export ("public") is written into the bundle at package time
// and never exists in a dev checkout, so its presence is the reliable gate for
// behaviour we only want for end users (e.g. auto-opening the browser on boot)
// without disturbing developers who run the server from a terminal.
function isPackagedBuild() {
  return fs.existsSync(resolvePath("public"));
}

// Root for anything the app writes at runtime. In a packaged install that's the
// user data folder above; in a dev checkout it stays APP_ROOT, so `npm run live`
// keeps using backend/data/log.db and backend/models exactly as before (that
// log.db holds the real-service detection history this project tunes against —
// relocating it under developers would strand that data).
//
// This split is what lets the app be installed into a location the operator
// can't write to (C:\Program Files, /Applications). Every runtime write goes
// through the two helpers below; nothing writes under APP_ROOT.
function writableRoot() {
  return isPackagedBuild() ? USER_DATA_ROOT : APP_ROOT;
}

// Resolves a writable file path, creating its parent directory. If the file
// doesn't exist yet but one does at the same relative path inside the install
// bundle, it's copied across first — that's the upgrade path for installs made
// before this split, whose log.db sits next to bin/ and would otherwise look
// like a brand-new install with no history.
function resolveWritablePath(...segments) {
  const target = path.join(writableRoot(), ...segments);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    const bundled = resolvePath(...segments);
    if (bundled !== target && fs.existsSync(bundled) && fs.statSync(bundled).isFile()) {
      fs.copyFileSync(bundled, target);
    }
  }
  return target;
}

// Same, for a directory the caller needs to exist (download targets and caches
// that third-party libraries write into themselves).
function resolveWritableDir(...segments) {
  const target = path.join(writableRoot(), ...segments);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

// Native addons (only better-sqlite3, currently) can't be embedded in a bundled
// Node SEA executable's snapshot — they must load from a real node_modules
// folder on disk via createRequire(), which also works identically in normal
// (unbundled) dev mode, so this is a safe drop-in replacement for plain
// require() everywhere a native module is needed.
function requireNative(id) {
  return createRequire(__filename)(id);
}

module.exports = {
  resolvePath,
  resolveWritablePath,
  resolveWritableDir,
  requireNative,
  isPackagedBuild,
  APP_ROOT,
  USER_DATA_ROOT,
};
