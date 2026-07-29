// Builds the macOS installer (.dmg containing Echo Intelligence.app) from an
// already-packaged dist/ tree.
//
// Same split as build-installer-windows.js: package.js produces the app, this
// produces one distribution format of it, so a failure here can't cost us the
// zip asset that already worked.
//
// darwin-only — hdiutil and codesign are macOS binaries, so this first runs on a
// macos-latest CI runner.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(ROOT, "..");
const DIST = path.join(ROOT, "dist");
const INSTALLER_DIR = path.join(REPO_ROOT, "installer", "macos");
const OUTPUT_DIR = path.join(ROOT, "installer-out");

// Everything in the bundle that has to be executable. Finder-launched bundles get
// no shell to fix modes for us, and git only preserves the owner-execute bit, so
// set them explicitly rather than relying on what came out of the checkout.
const MODE_EXEC = 0o755;

// Assembles Contents/ next to the .dmg staging root and returns the .app path.
//
// Layout is dictated by the SEA __dirname collapse (see backend/lib/paths.js):
// the whole dist/ tree goes to Contents/Resources/app/ untouched, so data/,
// public/ and node_modules/ stay siblings of bin/ exactly as the binary expects.
// Splitting them across Resources/ the way a hand-written bundle would would
// break every asset lookup.
function buildAppBundle(stagingDir, version) {
  const appDir = path.join(stagingDir, "Echo Intelligence.app");
  const contents = path.join(appDir, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  const plist = fs
    .readFileSync(path.join(INSTALLER_DIR, "Info.plist"), "utf8")
    .replaceAll("{{VERSION}}", version);
  fs.writeFileSync(path.join(contents, "Info.plist"), plist);

  const launcher = path.join(macos, "launcher");
  fs.copyFileSync(path.join(INSTALLER_DIR, "launcher"), launcher);
  fs.chmodSync(launcher, MODE_EXEC);

  fs.cpSync(DIST, path.join(resources, "app"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "assets", "icon.icns"), path.join(resources, "icon.icns"));

  // Beside the binary, because it cd's to its own directory before exec'ing.
  const command = path.join(resources, "app", "bin", "echo-intelligence.command");
  fs.copyFileSync(path.join(INSTALLER_DIR, "echo-intelligence.command"), command);
  fs.chmodSync(command, MODE_EXEC);

  // package.js already ad-hoc signed the bare SEA binary, but the bundle is a new
  // signable unit with its own Info.plist and launcher, and an unsigned bundle
  // around a signed binary is what makes macOS 13+ report the app as damaged
  // rather than merely unidentified. --deep so the nested binary and ffmpeg are
  // covered under the same (ad-hoc) identity.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appDir], { stdio: "inherit" });
  return appDir;
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("the macOS installer can only be built on macOS (hdiutil and codesign are macOS binaries)");
  }
  // A silently-empty installer is the exact failure mode that shipped a release
  // with no ffmpeg and, before that, no native binary — both passed a green
  // build. Check the payload is really there before wrapping it in a .dmg.
  const exePath = path.join(DIST, "bin", "echo-intelligence");
  if (!fs.existsSync(exePath)) {
    throw new Error(`no packaged app at ${exePath} — run \`npm run package\` first`);
  }

  const version = require(path.join(ROOT, "package.json")).version;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Staged in a scratch dir that becomes the disk image's root, so whatever is in
  // here is exactly what the operator sees after mounting: the app, and the
  // /Applications alias they drag it onto.
  const stagingDir = path.join(ROOT, "installer-staging");
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  buildAppBundle(stagingDir, version);
  fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));

  // Named with the version so a downloads page can link a specific release and a
  // user's Downloads folder doesn't end up with three files called "setup".
  const dmgPath = path.join(OUTPUT_DIR, `echo-intelligence-${version}-macos.dmg`);
  fs.rmSync(dmgPath, { force: true }); // hdiutil refuses to overwrite

  // UDZO = zlib-compressed read-only, the standard shipping format; the tree is
  // mostly already-compressed binaries, so this is about read-only-ness and a
  // single-file download more than it is about ratio.
  execFileSync("hdiutil", [
    "create", "-volname", "Echo Intelligence", "-srcfolder", stagingDir,
    "-ov", "-format", "UDZO", dmgPath,
  ], { stdio: "inherit" });

  fs.rmSync(stagingDir, { recursive: true, force: true });

  if (!fs.existsSync(dmgPath)) {
    throw new Error(`hdiutil reported success but ${dmgPath} does not exist`);
  }
  const mb = (fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1);
  console.log(`\ndone: ${dmgPath} (${mb} MB)`);
}

main();
