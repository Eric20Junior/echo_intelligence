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
curl -fL --progress-bar "$URL" -o "$TMP_ZIP"

mkdir -p "$DEST"
echo "Unzipping to $DEST..."
unzip -oq "$TMP_ZIP" -d "$DEST"
chmod +x "$DEST/bin/echo-intelligence"

EXE="$DEST/bin/echo-intelligence"
# Shipped with the frontend's static export, so it's present in every install.
# Only 16x16/32x32 though — fine at small sizes, soft when the desktop draws it
# large. Worth replacing with a proper multi-resolution icon at some point.
ICON="$DEST/public/favicon.ico"

# Desktop / app-menu shortcut, so the operator double-clicks an icon instead of
# typing a path into a terminal (the whole point of this being installable at
# all). Best-effort throughout: every failure below is suppressed, because a
# missing shortcut is cosmetic and must never fail an otherwise-good install.
#
# Deliberately launched *with* a terminal window rather than as a silent
# background process: that window is the operator's stop button ("close it to
# quit") and the only place startup errors are visible. The app opens the
# operator page in their browser by itself once it's up (lib/open-browser.js).
create_linux_shortcut() {
  local apps_dir="$HOME/.local/share/applications"
  local desktop_file="$apps_dir/echo-intelligence.desktop"
  mkdir -p "$apps_dir"
  cat > "$desktop_file" <<EOF
[Desktop Entry]
Type=Application
Name=Echo Intelligence
Comment=Live scripture detection for church services
Exec="$EXE"
Path=$DEST/bin
Icon=$ICON
Terminal=true
Categories=AudioVideo;Audio;
EOF
  chmod +x "$desktop_file"
  # Makes it show up in the app menu / activities search right away instead of
  # after the next login.
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" 2>/dev/null

  # Also drop a copy on the Desktop itself. GNOME and friends refuse to launch a
  # .desktop file from ~/Desktop until it's marked trusted, hence the gio call.
  local desktop_dir
  desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
  if [ -d "$desktop_dir" ]; then
    cp "$desktop_file" "$desktop_dir/echo-intelligence.desktop"
    chmod +x "$desktop_dir/echo-intelligence.desktop"
    command -v gio >/dev/null 2>&1 &&
      gio set "$desktop_dir/echo-intelligence.desktop" metadata::trusted true 2>/dev/null
  fi
}

# No .app bundle here on purpose — an unsigned bundle hits the same Gatekeeper
# block as the bare executable (see the note printed below) while adding a
# Contents/Info.plist to keep correct. Double-clicking a .command opens Terminal
# and runs it, which gives the same window-is-the-stop-button behaviour as Linux.
create_macos_shortcut() {
  local desktop_dir="$HOME/Desktop"
  [ -d "$desktop_dir" ] || return 0
  local launcher="$desktop_dir/Echo Intelligence.command"
  cat > "$launcher" <<EOF
#!/usr/bin/env bash
cd "$DEST/bin"
exec "$EXE"
EOF
  chmod +x "$launcher"
}

SHORTCUT_MADE=""
if [ "$OS_NAME" = "linux" ]; then
  create_linux_shortcut 2>/dev/null && SHORTCUT_MADE="1" || true
else
  create_macos_shortcut 2>/dev/null && SHORTCUT_MADE="1" || true
fi

echo
echo "Installed to $DEST"
if [ -n "$SHORTCUT_MADE" ]; then
  if [ "$OS_NAME" = "linux" ]; then
    echo "Start it from the \"Echo Intelligence\" icon on your desktop or in your app menu."
  else
    echo "Start it from the \"Echo Intelligence\" icon on your desktop."
  fi
  echo "It opens the operator page in your browser automatically."
  echo "(Or run it directly: $EXE)"
else
  echo "Run it with: $EXE"
  echo "It opens the operator page in your browser automatically."
fi
if [ "$OS_NAME" = "macos" ]; then
  echo
  echo "Note: the app isn't Apple-notarized. If macOS refuses to open it,"
  echo "right-click the icon in Finder and choose Open once."
fi
