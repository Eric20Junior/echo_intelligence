// Single source of truth for resolving app-relative paths (data files, overlay
// HTML, .env). Needed for packaging (roadmap Phase 6): bundling every file into
// one script for a Node SEA executable collapses each file's own __dirname to
// the same shared value (verified directly — see docs/roadmap.md), which
// silently breaks the old pattern of scattering `path.join(__dirname, "..", ...)`
// across multiple files, each assuming its own location. Centralizing it here
// means only this one file's relative-depth assumption needs to be correct.
const path = require("path");
const { createRequire } = require("module");

const APP_ROOT = path.join(__dirname, "..");

function resolvePath(...segments) {
  return path.join(APP_ROOT, ...segments);
}

// Native addons (only better-sqlite3, currently) can't be embedded in a bundled
// Node SEA executable's snapshot — they must load from a real node_modules
// folder on disk via createRequire(), which also works identically in normal
// (unbundled) dev mode, so this is a safe drop-in replacement for plain
// require() everywhere a native module is needed.
function requireNative(id) {
  return createRequire(__filename)(id);
}

module.exports = { resolvePath, requireNative, APP_ROOT };
