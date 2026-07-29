// Opens the operator/setup page in the default browser on boot, so a
// non-technical operator never has to know to type http://localhost:8787 into a
// browser themselves (roadmap Phase 6 — the packaged app is launched by
// double-clicking, which opens only a bare console window otherwise).
//
// No dependency: shells out to the OS's own "open a URL in the default handler"
// command — `start` on Windows, `open` on macOS, `xdg-open` on Linux. Best-effort
// by design: a headless box, a missing xdg-open, or any spawn failure is swallowed
// (the console still prints the URL as a fallback), because failing to open a
// browser must never take down the server it was launched alongside.
const { spawn } = require("child_process");

function openBrowser(url) {
  // Escape hatch for a headless box, a kiosk that manages its own browser, or a
  // developer who finds the auto-open intrusive — the console still prints the URL.
  if (process.env.ECHO_NO_BROWSER === "1") return;

  let command;
  let args;
  if (process.platform === "win32") {
    // `start` is a cmd builtin, not an executable — must go through cmd.exe. The
    // empty "" is start's window-title argument; without it a quoted URL would be
    // treated as the title and no page would open.
    command = "cmd";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    // Don't keep the event loop / parent alive on account of the launcher process,
    // and swallow the async ENOENT (e.g. no xdg-open installed) that spawn emits
    // as an 'error' event rather than a throw.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Sync spawn failure — ignore, same best-effort contract as above.
  }
}

module.exports = { openBrowser };
