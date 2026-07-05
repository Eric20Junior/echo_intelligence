#!/usr/bin/env bash
# One-line installer for macOS/Linux: downloads the latest prebuilt release
# (built by .github/workflows/package.yml from a version tag) and unzips it.
# No git or Node.js required on the machine running this script — the release
# asset is a self-contained Node Single Executable Application plus its data
# files (see backend/scripts/package.js).
set -euo pipefail

REPO="Eric20Junior/echo_intelligence"
DEST="${1:-$HOME/echo-intelligence}"

case "$(uname -s)" in
  Linux) OS_NAME="linux" ;;
  Darwin) OS_NAME="macos" ;;
  *)
    echo "Unsupported OS: $(uname -s). On Windows, run install.ps1 instead." >&2
    exit 1
    ;;
esac

URL="https://github.com/$REPO/releases/latest/download/echo-intelligence-$OS_NAME.zip"
TMP_ZIP="$(mktemp -t echo-intelligence-XXXXXX).zip"
trap 'rm -f "$TMP_ZIP"' EXIT

echo "Downloading Echo Intelligence ($OS_NAME)..."
curl -fL "$URL" -o "$TMP_ZIP"

mkdir -p "$DEST"
echo "Unzipping to $DEST..."
unzip -oq "$TMP_ZIP" -d "$DEST"
chmod +x "$DEST/bin/echo-intelligence"

echo
echo "Installed to $DEST"
echo "Run it with: $DEST/bin/echo-intelligence"
echo "Then open http://localhost:8787/ in your browser."
if [ "$OS_NAME" = "macos" ]; then
  echo
  echo "Note: the app isn't Apple-notarized. If macOS refuses to open it,"
  echo "right-click the executable in Finder and choose Open once."
fi
