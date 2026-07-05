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
let resolvedFfmpegPath = null;
function resolveFfmpegPath() {
  if (resolvedFfmpegPath) return resolvedFfmpegPath;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    resolvedFfmpegPath = "ffmpeg";
  } catch {
    resolvedFfmpegPath = staticFfmpegPath;
  }
  return resolvedFfmpegPath;
}

function listDevices() {
  if (process.platform === "win32") return listDevicesWindows();
  if (process.platform === "darwin") return listDevicesMac();
  return listDevicesLinux();
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

// ffmpeg -list_devices true -f dshow -i dummy writes device names to stderr, e.g.:
//   [dshow @ ...] "Microphone (Realtek Audio)" (audio)
function listDevicesWindows() {
  return new Promise((resolve) => {
    execFile(resolveFfmpegPath(), ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], (_err, _stdout, stderr) => {
      const devices = [{ id: "default", label: "System default" }];
      const lineRe = /"([^"]+)"\s*\(audio\)/g;
      let match;
      while ((match = lineRe.exec(stderr || ""))) {
        devices.push({ id: match[1], label: match[1] });
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
    const input = device && device !== "default" ? `audio=${device}` : "audio=default";
    return ["-f", "dshow", "-i", input, ...output];
  }
  if (process.platform === "darwin") {
    const input = device && device !== "default" ? `:${device}` : ":0";
    return ["-f", "avfoundation", "-i", input, ...output];
  }
  const input = device && device !== "default" ? device : "default";
  return ["-f", "alsa", "-i", input, ...output];
}

function start({ device, onChunk, onError }) {
  const ffmpeg = spawn(resolveFfmpegPath(), buildArgs(device));
  ffmpeg.stdout.on("data", onChunk);
  ffmpeg.stderr.on("data", (chunk) => console.error("ffmpeg:", chunk.toString().trim()));
  ffmpeg.on("error", (err) => {
    onError?.(new Error(`failed to start ffmpeg capture: ${err.message}`));
  });

  return { stop: () => ffmpeg.kill() };
}

module.exports = { listDevices, start, SAMPLE_RATE };
