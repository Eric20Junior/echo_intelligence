// Builds the Windows installer (.exe) from an already-packaged dist/ tree.
//
// Split from scripts/package.js on purpose: package.js produces the app, this
// produces one distribution format of it. The zip release asset still comes
// straight from dist/, so a failure here can't cost us the artifact that already
// worked.
//
// Requires Inno Setup's compiler (ISCC.exe), which is preinstalled on GitHub's
// windows-latest runners. Locally: `winget install JRSoftware.InnoSetup`.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(ROOT, "..");
const DIST = path.join(ROOT, "dist");
const INSTALLER_DIR = path.join(REPO_ROOT, "installer", "windows");
const SCRIPT = path.join(INSTALLER_DIR, "echo-intelligence.iss");
const OUTPUT_DIR = path.join(ROOT, "installer-out");

// ISCC isn't added to PATH by the Inno Setup installer, and the runner image
// documentation doesn't promise a location either — so look where it actually
// lands (6.x installs 32-bit by default, hence Program Files (x86) first) and
// fall back to PATH in case a future image does add it.
function findIscc() {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Inno Setup 6", "ISCC.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Inno Setup 6", "ISCC.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "ISCC.exe";
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("the Windows installer can only be built on Windows (ISCC.exe is a Windows binary)");
  }
  // A silently-empty installer is the exact failure mode that shipped a release
  // with no ffmpeg and, before that, no native binary — both passed a green
  // build. Check the payload is really there before handing it to ISCC.
  const exePath = path.join(DIST, "bin", "echo-intelligence.exe");
  if (!fs.existsSync(exePath)) {
    throw new Error(`no packaged app at ${exePath} — run \`npm run package\` first`);
  }

  const version = require(path.join(ROOT, "package.json")).version;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Named with the version so a downloads page can link a specific release and
  // a user's Downloads folder doesn't end up with three files called "setup".
  const outputName = `echo-intelligence-${version}-windows-setup`;

  execFileSync(
    findIscc(),
    [
      `/DMyAppVersion=${version}`,
      `/DSourceDir=${DIST}`,
      `/DOutputDir=${OUTPUT_DIR}`,
      `/DOutputName=${outputName}`,
      `/DIconFile=${path.join(REPO_ROOT, "assets", "icon.ico")}`,
      SCRIPT,
    ],
    { stdio: "inherit" },
  );

  const installerPath = path.join(OUTPUT_DIR, `${outputName}.exe`);
  if (!fs.existsSync(installerPath)) {
    throw new Error(`ISCC reported success but ${installerPath} does not exist`);
  }
  const mb = (fs.statSync(installerPath).size / 1024 / 1024).toFixed(1);
  console.log(`\ndone: ${installerPath} (${mb} MB)`);
}

main();
