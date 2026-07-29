// Packaging build for roadmap Phase 6 — produces a standalone folder containing
// a Node Single Executable Application (SEA) + the external assets it needs
// (native better-sqlite3 binding, node-llama-cpp binding + GGUF model, verse
// database, the built frontend).
//
// VERIFICATION STATUS: the Linux path (this whole script, run with
// `node scripts/package.js` on this machine) has been run end-to-end and
// confirmed working — the resulting executable boots, serves both HTTP pages,
// lists mic devices, and starts a live capture session. The Windows/macOS
// branches below follow Node's documented SEA process exactly, but have not
// been executed on those OSes (this dev environment is Linux-only) — see
// docs/roadmap.md's Phase 6 section before treating them as verified.
//
// Distribution layout (why it matters: see lib/paths.js's header comment —
// bundling collapses every file's __dirname to the executable's own directory,
// so data/models/public/node_modules must be siblings of the folder containing
// the executable, not inside it):
//   dist/
//     bin/echo-intelligence(.exe)   <- the SEA executable
//     bin/ffmpeg(.exe)              <- audio capture (see copyFfmpegBinary below)
//     bin/node_modules/             <- better-sqlite3 + node-llama-cpp + their transitive deps
//     data/verses.db
//     models/                       <- empty; the local LLM's .gguf is downloaded on
//                                      first use, not shipped (see main() below)
//     public/                       <- frontend's static export (`next build`, output: "export"),
//                                      served by lib/server/api-server.js — see its header comment
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(ROOT, "..");
const FRONTEND_DIR = path.join(REPO_ROOT, "frontend");
const DIST = path.join(ROOT, "dist");
const BIN_DIR = path.join(DIST, "bin");
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// ffmpeg is the entire capture path on every OS (lib/capture/mic-source.js —
// there is no second, platform-specific capture backend), and its binary is a
// plain executable inside the ffmpeg-static package rather than a require()d
// module, so esbuild bundles only that package's path-resolution code and
// never the binary itself. Omitting this copy shipped a build that could not
// capture audio at all: ffmpeg-static resolves to <bin>/ffmpeg(.exe), which
// didn't exist. Linux masked it (mic-source prefers a system ffmpeg, and
// desktop Linux nearly always has one); on Windows it surfaced as an empty
// device dropdown and a silent, permanently-flat level meter.
//
// Destination is BIN_DIR specifically because ffmpeg-static computes its path
// from its own __dirname, which the SEA bundle collapses to the executable's
// folder (see lib/paths.js) — this is the one location that resolution finds.
function copyFfmpegBinary() {
  const src = require("ffmpeg-static");
  if (!src || !fs.existsSync(src)) {
    throw new Error(
      `ffmpeg-static has no binary for ${process.platform}-${process.arch} at ${src} — ` +
        "run `npm ci` (its postinstall downloads the platform binary) before packaging",
    );
  }
  const dest = path.join(BIN_DIR, path.basename(src));
  fs.copyFileSync(src, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
}

function copyNativeDep(name) {
  fs.cpSync(path.join(ROOT, "node_modules", name), path.join(BIN_DIR, "node_modules", name), { recursive: true });
}

// node-llama-cpp's actual native binary ships as a *separate* npm package per
// platform/arch/backend (e.g. @node-llama-cpp/linux-x64-cuda), listed only
// under node-llama-cpp's optionalDependencies -- copyWithTransitiveDeps below
// only walks regular "dependencies", so it never copies any of these. Verified
// directly: a packaged build tested from a truly isolated copy (no surrounding
// dev node_modules to fall back on, matching a real user's extracted install)
// had no native binary at all and tried to git-clone + compile llama.cpp from
// source via cmake-js, which non-technical operators don't have installed.
// lib/detection/fallback/local-llm.js forces gpu: false unconditionally
// (unpredictable GPU drivers on operator laptops), so exactly one CPU-only
// variant per platform is both correct AND avoids bundling the GPU variants'
// dead weight (confirmed: linux-x64-cuda-ext alone is 365MB on this machine).
const NODE_LLAMA_CPP_BINARY_PACKAGE = {
  "linux-x64": "@node-llama-cpp/linux-x64",
  "linux-arm64": "@node-llama-cpp/linux-arm64",
  "linux-arm": "@node-llama-cpp/linux-armv7l",
  "darwin-x64": "@node-llama-cpp/mac-x64",
  // No CPU-only build is published for Apple Silicon -- Metal is the only
  // available backend for darwin-arm64, so this isn't bloat to trim.
  "darwin-arm64": "@node-llama-cpp/mac-arm64-metal",
  "win32-x64": "@node-llama-cpp/win-x64",
  "win32-arm64": "@node-llama-cpp/win-arm64",
}[`${process.platform}-${process.arch}`];

// onnxruntime-node (a regular dependency of @huggingface/transformers, the
// local Whisper STT option) bundles prebuilt binaries for every OS/arch AND
// an unused CUDA/TensorRT runtime inside its own package folder -- confirmed
// directly: libonnxruntime_providers_cuda.so alone is 156MB, even though
// lib/capture/stt-source-local.js never requests GPU acceleration. Trim to
// just the current platform/arch's CPU provider.
function pruneOnnxRuntimeBinaries() {
  const napiDir = path.join(BIN_DIR, "node_modules", "onnxruntime-node", "bin", "napi-v6");
  const platformDir = { win32: "win32", darwin: "darwin", linux: "linux" }[process.platform];
  for (const entry of fs.readdirSync(napiDir)) {
    if (entry !== platformDir) fs.rmSync(path.join(napiDir, entry), { recursive: true, force: true });
  }
  const archDir = path.join(napiDir, platformDir, process.arch);
  for (const file of fs.readdirSync(archDir)) {
    if (/providers_(cuda|tensorrt)/i.test(file)) fs.rmSync(path.join(archDir, file));
  }
}

// Packages that are reachable through "dependencies" but provably unused at
// runtime, so copyWithTransitiveDeps skips them (and anything only they pull in).
//
// onnxruntime-web is @huggingface/transformers' *browser* ONNX runtime, and it is a
// hard dependency rather than an optional one, so the walk below would copy it —
// 130MB of WebAssembly, the single largest thing in the bundle, into a Node-only
// backend. Verified unused: transformers' Node entry point (dist/transformers.node.cjs,
// its package.json "main") only ever require()s onnxruntime-node and
// onnxruntime-common. The one piece of onnxruntime-web it does use (the WebGPU
// bundle) is already inlined into that same .cjs file by its own build, and the
// matching .wasm is fetched from a CDN at runtime, so nothing reads this directory.
const EXCLUDED_PACKAGES = new Set(["onnxruntime-web"]);

// node-llama-cpp has ~27 direct dependencies (npm hoists them flat into node_modules/,
// not nested under node-llama-cpp/node_modules/), each with their own further
// dependencies. Hand-picking a subset like copyNativeDep does for better-sqlite3 would
// silently produce a MODULE_NOT_FOUND crash in the packaged executable the first time
// an untested code path needs a dep that got missed. Instead, walk package.json's
// "dependencies" recursively and copy every package actually reachable from the given
// entry package — correct by construction rather than by a maintained list.
function copyWithTransitiveDeps(name, copied = new Set()) {
  if (copied.has(name) || EXCLUDED_PACKAGES.has(name)) return;
  copied.add(name);
  const srcDir = path.join(ROOT, "node_modules", name);
  fs.cpSync(srcDir, path.join(BIN_DIR, "node_modules", name), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies || {})) {
    copyWithTransitiveDeps(dep, copied);
  }
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(BIN_DIR, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(DIST, "data"), { recursive: true });
  // Created empty on purpose. The local LLM's ~470MB .gguf is deliberately NOT
  // bundled: it was over half the download, and the two default backends
  // (Anthropic, Gemini) never load it, so nearly every install paid for bytes it
  // never used — on church wifi that's where people give up. local-llm.js already
  // fetches it via node-llama-cpp's resolveModelFile(), which needs this directory
  // to exist as its writable target; scripts/live-demo.js warms it at startup so
  // the download can't land mid-service.
  fs.mkdirSync(path.join(DIST, "models"), { recursive: true });

  // npx (like npm) ships as a .cmd shell shim on Windows, not a directly
  // executable binary — execFileSync needs shell: true there or it fails
  // with ENOENT (confirmed directly against a real windows-latest CI run).
  const npxOpts = { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" };

  console.log("bundling...");
  execFileSync(
    "npx",
    ["esbuild", "scripts/live-demo.js", "--bundle", "--platform=node", "--target=node20",
     "--external:better-sqlite3", "--external:node-llama-cpp", "--external:@huggingface/transformers",
     "--outfile=" + path.join(BIN_DIR, "app.js")],
    npxOpts
  );

  console.log("copying native deps + data assets...");
  copyFfmpegBinary();
  copyNativeDep("better-sqlite3");
  copyNativeDep("bindings");
  copyNativeDep("file-uri-to-path");
  copyWithTransitiveDeps("node-llama-cpp");
  if (!NODE_LLAMA_CPP_BINARY_PACKAGE) {
    throw new Error(`No known @node-llama-cpp binary package for ${process.platform}-${process.arch}`);
  }
  copyNativeDep(NODE_LLAMA_CPP_BINARY_PACKAGE);
  // @huggingface/transformers (the local Whisper STT option, lib/capture/stt-source-local.js)
  // pulls in onnxruntime-node's prebuilt .node binaries for every platform/arch via a
  // template-string require esbuild can't statically resolve — marked external above and
  // copied whole here instead, same reasoning as node-llama-cpp.
  copyWithTransitiveDeps("@huggingface/transformers");
  pruneOnnxRuntimeBinaries();
  fs.copyFileSync(path.join(ROOT, "data", "verses.db"), path.join(DIST, "data", "verses.db"));

  const modelFiles = fs.readdirSync(path.join(ROOT, "models")).filter((f) => f.endsWith(".gguf"));
  if (modelFiles.length > 0) {
    console.log(`not bundling ${modelFiles.length} local model file(s) — fetched on demand instead, see above`);
  }

  console.log("building frontend...");
  // `next build` with output: "export" (frontend/next.config.ts) produces plain
  // static HTML/JS/CSS in frontend/out/ — no separate Next server needed at
  // runtime, lib/server/api-server.js serves this directory directly.
  // npm ships as npm.cmd (a shell shim) on Windows, not a directly-executable
  // binary — execFileSync needs shell: true there or it fails with ENOENT.
  const npmOpts = { cwd: FRONTEND_DIR, stdio: "inherit", shell: process.platform === "win32" };
  execFileSync("npm", ["ci"], npmOpts);
  execFileSync("npm", ["run", "build"], npmOpts);
  fs.cpSync(path.join(FRONTEND_DIR, "out"), path.join(DIST, "public"), { recursive: true });

  console.log("building SEA blob...");
  const seaConfigPath = path.join(DIST, "sea-config.json");
  const blobPath = path.join(BIN_DIR, "prep.blob");
  fs.writeFileSync(seaConfigPath, JSON.stringify({
    main: path.relative(DIST, path.join(BIN_DIR, "app.js")),
    output: path.relative(DIST, blobPath),
    disableExperimentalSEAWarning: true,
  }));
  execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: DIST, stdio: "inherit" });

  const exeName = process.platform === "win32" ? "echo-intelligence.exe" : "echo-intelligence";
  const exePath = path.join(BIN_DIR, exeName);
  fs.copyFileSync(process.execPath, exePath);

  if (process.platform === "darwin") {
    // macOS requires removing the copied node binary's existing signature before
    // injection, then ad-hoc re-signing after — otherwise Gatekeeper refuses to
    // run it at all (not just an "unidentified developer" warning, a hard block).
    execFileSync("codesign", ["--remove-signature", exePath]);
  }

  console.log("injecting SEA blob...");
  const postjectArgs = [exePath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE];
  if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
  execFileSync("npx", ["postject", ...postjectArgs], { stdio: "inherit", shell: process.platform === "win32" });

  if (process.platform === "darwin") {
    execFileSync("codesign", ["--sign", "-", exePath]);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(exePath, 0o755);
  }

  fs.rmSync(seaConfigPath);
  fs.rmSync(blobPath);

  console.log(`\ndone: ${exePath}`);
  console.log("run it from its own folder (dist/bin/) so it finds ../data and ../overlay as siblings.");
}

main();
