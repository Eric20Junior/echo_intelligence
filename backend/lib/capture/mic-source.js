// Mic capture stage (roadmap Phase 3, made cross-platform in Phase 6): device
// enumeration + capture, now via a bundled ffmpeg binary instead of `arecord`
// (ALSA-only, Linux-specific) so this runs on Windows/macOS/Linux without the
// operator installing anything extra. Public API (listDevices/start) is
// unchanged from Phase 3, so lib/session.js needs zero changes.
//
// Linux path is tested in this environment. Windows (dshow) and macOS
// (avfoundation) paths are written against ffmpeg's documented CLI interface
// but have not been run on those OSes — flagged in docs/roadmap.md as a
// required follow-up before Phase 6 is considered fully verified.
const { execFile, execFileSync, spawn } = require("child_process");
const fs = require("fs");
const staticFfmpegPath = require("ffmpeg-static");

const SAMPLE_RATE = 16000;

// Prefer a system-installed ffmpeg when present. On Linux specifically, distro
// packages of ffmpeg link against the system's actual alsa-lib/plugin layout,
// while the precompiled ffmpeg-static binary has been observed to bake in a
// mismatched ALSA plugin search path (fails with "cannot open shared library
// libasound_module_conf_pulse.so" even though the file exists, just at a
// different multiarch path) — a packaging quirk of the static build, not a
// real capture problem, confirmed by the same `ffmpeg -f alsa -i default`
// command working fine when it resolves to the system binary. Falls back to
// the bundled static binary (the normal case on Windows/macOS, which don't
// have this ALSA-specific plugin-loading behavior) if no system ffmpeg exists.
//
// Returns null when neither is available, rather than a path to a file that
// isn't there. That case was shipped for real: scripts/package.js never copied
// the ffmpeg-static binary into dist/, so every packaged build resolved to a
// nonexistent <bin>/ffmpeg(.exe). Linux hid it (a system ffmpeg is nearly
// always present), Windows didn't — capture produced an empty device list and
// a "no capture device found, check mic permissions" error that sent an
// operator hunting through Windows privacy settings for a packaging bug.
let resolvedFfmpegPath = null;
let ffmpegResolved = false;
function resolveFfmpegPath() {
  if (ffmpegResolved) return resolvedFfmpegPath;
  ffmpegResolved = true;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    resolvedFfmpegPath = "ffmpeg";
    return resolvedFfmpegPath;
  } catch {
    // No system ffmpeg — fall through to the bundled one.
  }
  // ffmpeg-static resolves its binary relative to its own __dirname, which the
  // SEA bundle collapses to the executable's own folder (see lib/paths.js), so
  // this path is only correct because package.js now copies the binary there.
  if (staticFfmpegPath && fs.existsSync(staticFfmpegPath)) resolvedFfmpegPath = staticFfmpegPath;
  return resolvedFfmpegPath;
}

const FFMPEG_MISSING_MESSAGE =
  "ffmpeg is missing from this install, so no audio can be captured. This is a packaging problem, not a " +
  "microphone permission problem — reinstall Echo Intelligence to get a build that bundles it, or install " +
  "ffmpeg yourself and make sure it's on PATH.";

// Lets callers (the /api/devices route, session start) tell "ffmpeg isn't
// here" apart from "ffmpeg ran and found no microphone" — two failures with
// the same visible symptom (an empty device list) but completely different fixes.
function checkFfmpeg() {
  return resolveFfmpegPath() ? { ok: true } : { ok: false, message: FFMPEG_MISSING_MESSAGE };
}

function listDevices() {
  // Linux enumerates via arecord, which doesn't need ffmpeg at all; the other
  // two do, and execFile'ing a null path would throw rather than degrade.
  if (process.platform === "win32") return resolveFfmpegPath() ? listDevicesWindows() : Promise.resolve(defaultDeviceOnly());
  if (process.platform === "darwin") return resolveFfmpegPath() ? listDevicesMac() : Promise.resolve(defaultDeviceOnly());
  return listDevicesLinux();
}

function defaultDeviceOnly() {
  return [{ id: "default", label: "System default" }];
}

// Parses `arecord -l` output, e.g.:
//   card 0: PCH [HDA Intel PCH], device 0: ALC3204 Analog [ALC3204 Analog]
// Listing-only — capture itself no longer uses arecord (see start() below),
// but arecord/alsa-utils is a near-universal Linux desktop package and this
// parsing was already field-tested, so it stays for enumeration.
function listDevicesLinux() {
  return new Promise((resolve) => {
    execFile("arecord", ["-l"], (err, stdout) => {
      const devices = [{ id: "default", label: "System default" }];
      if (err) {
        resolve(devices);
        return;
      }
      const cardRe = /^card (\d+): .+? \[([^\]]+)\], device (\d+): .+? \[([^\]]+)\]/gm;
      let match;
      while ((match = cardRe.exec(stdout))) {
        const [, cardNum, cardLabel, deviceNum, deviceLabel] = match;
        devices.push({ id: `hw:${cardNum},${deviceNum}`, label: `${cardLabel} — ${deviceLabel}` });
      }
      resolve(devices);
    });
  });
}

// Windows names its "capture what the speakers are playing" device differently
// per audio driver, and it's the only way to feed system audio (a recorded
// sermon, a Zoom feed, a video played on the same machine) straight into
// transcription without a microphone in the loop at all. Operators don't know
// to look for these names, so they get labelled in the dropdown instead.
const LOOPBACK_PATTERNS = [/stereo mix/i, /what u hear/i, /wave out/i, /loopback/i, /virtual.?audio/i, /vb-?audio/i, /voicemeeter/i];

function isLoopbackDevice(name) {
  return LOOPBACK_PATTERNS.some((re) => re.test(name));
}

// ffmpeg -list_devices true -f dshow -i dummy writes device names to stderr, e.g.:
//   [dshow @ ...] "Microphone (Realtek Audio)" (audio)
function listDevicesWindows() {
  return new Promise((resolve) => {
    execFile(resolveFfmpegPath(), ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], (_err, _stdout, stderr) => {
      const devices = [{ id: "default", label: "System default" }];
      const lineRe = /"([^"]+)"\s*\(audio\)/g;
      let match;
      while ((match = lineRe.exec(stderr || ""))) {
        const name = match[1];
        devices.push({ id: name, label: isLoopbackDevice(name) ? `${name} — plays computer audio` : name });
      }
      resolve(devices);
    });
  });
}

// ffmpeg -f avfoundation -list_devices true -i "" writes device names to stderr, e.g.:
//   [AVFoundation ...] [0] Built-in Microphone
function listDevicesMac() {
  return new Promise((resolve) => {
    execFile(resolveFfmpegPath(), ["-f", "avfoundation", "-list_devices", "true", "-i", ""], (_err, _stdout, stderr) => {
      const devices = [{ id: "default", label: "System default" }];
      const lineRe = /\[(\d+)\]\s+(.+)/g;
      let match;
      let inAudioSection = false;
      for (const line of (stderr || "").split("\n")) {
        if (/AVFoundation audio devices/i.test(line)) inAudioSection = true;
        if (!inAudioSection) continue;
        const m = /\[(\d+)\]\s+(.+)/.exec(line);
        if (m) devices.push({ id: m[1], label: m[2].trim() });
      }
      resolve(devices);
    });
  });
}

function buildArgs(device) {
  const output = ["-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-loglevel", "error", "-"];

  if (process.platform === "win32") {
    // dshow has no "default" device keyword like ALSA/avfoundation do — it only
    // matches a device by its exact enumerated name. Passing "audio=default"
    // literally fails to find a device named "default" and ffmpeg exits with no
    // audio and no thrown error, which is why this must already be resolved to
    // a real device name by the time buildArgs runs (see start() below).
    return ["-f", "dshow", "-i", `audio=${device}`, ...output];
  }
  if (process.platform === "darwin") {
    const input = device && device !== "default" ? `:${device}` : ":0";
    return ["-f", "avfoundation", "-i", input, ...output];
  }
  const input = device && device !== "default" ? device : "default";
  return ["-f", "alsa", "-i", input, ...output];
}

// dshow needs a concrete device name; resolve "default"/unset to the first
// enumerated audio capture device. Throws if Windows has no audio capture
// device enumerable at all (e.g. mic privacy permission blocking ffmpeg, or no
// mic/loopback device present) so the caller can surface a real error instead
// of silently capturing nothing.
async function resolveWindowsDevice(device) {
  if (device && device !== "default") return device;
  const devices = (await listDevicesWindows()).filter((d) => d.id !== "default");
  if (devices.length === 0) {
    throw new Error(
      "no audio capture device found on Windows — check Settings > Privacy & security > Microphone " +
        "(allow desktop apps to access the microphone), and that a microphone or a loopback device " +
        '(e.g. "Stereo Mix") is enabled in Sound settings',
    );
  }
  // "System default" on Windows means "whatever dshow enumerated first", which
  // is not necessarily the device the operator assumed — a laptop with a webcam
  // plugged in often enumerates the webcam's mic ahead of the built-in one.
  // Logged by name so a wrong-device session is diagnosable from the console
  // rather than looking identical to a mic that simply isn't hearing anything.
  console.log(`capture: dshow "default" resolved to "${devices[0].id}"`);
  return devices[0].id;
}

async function start({ device, onChunk, onError }) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    onError?.(new Error(FFMPEG_MISSING_MESSAGE));
    return { stop: () => {} };
  }

  let resolvedDevice = device;
  if (process.platform === "win32") {
    try {
      resolvedDevice = await resolveWindowsDevice(device);
    } catch (err) {
      onError?.(err);
      return { stop: () => {} };
    }
  }

  const ffmpeg = spawn(ffmpegPath, buildArgs(resolvedDevice));
  let receivedData = false;
  ffmpeg.stdout.on("data", (chunk) => {
    receivedData = true;
    onChunk(chunk);
  });
  ffmpeg.stderr.on("data", (chunk) => console.error("ffmpeg:", chunk.toString().trim()));
  ffmpeg.on("error", (err) => {
    onError?.(new Error(`failed to start ffmpeg capture: ${err.message}`));
  });
  ffmpeg.on("exit", (code) => {
    if (code !== 0 && code !== null && !receivedData) {
      onError?.(new Error(`ffmpeg capture exited immediately (code ${code}) without producing audio — check the selected device`));
    }
  });

  return { stop: () => ffmpeg.kill() };
}

module.exports = { listDevices, start, checkFfmpeg, isLoopbackDevice, SAMPLE_RATE };
