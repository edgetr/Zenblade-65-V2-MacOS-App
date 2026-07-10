#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:${HOME}/.local/bin:${PATH}"
export CSC_IDENTITY_AUTO_DISCOVERY=false

APP_NAME="Zenblade"
SRC_APP="$ROOT/dist/mac-arm64/${APP_NAME}.app"
DEST_APP="/Applications/${APP_NAME}.app"
STAGE_DIR="$(mktemp -d /tmp/zenblade-install.XXXXXX)"
STAGED_APP="$STAGE_DIR/${APP_NAME}.app"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "Building ${APP_NAME}..."
npm install --silent
npx electron-builder --mac dir --arm64

if [[ ! -d "$SRC_APP" ]]; then
  echo "Build failed: missing $SRC_APP" >&2
  exit 1
fi

# Desktop/iCloud workspaces can immediately re-add Finder/FileProvider xattrs,
# which makes codesign reject an otherwise valid bundle. Stage outside the
# workspace without extended attributes, then sign and verify that clean copy.
ditto --noextattr --norsrc "$SRC_APP" "$STAGED_APP"
xattr -cr "$STAGED_APP"
codesign --force --deep --sign - "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"

echo "Installing to ${DEST_APP}..."
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 0.4
pkill -x "$APP_NAME" 2>/dev/null || true
osascript -e 'tell application "Zenblade Control" to quit' 2>/dev/null || true
pkill -x "Zenblade Control" 2>/dev/null || true
sleep 0.3

rm -rf "$DEST_APP"
rm -rf "/Applications/Zenblade Control.app" 2>/dev/null || true
ditto --noextattr --norsrc "$STAGED_APP" "$DEST_APP"
xattr -cr "$DEST_APP" 2>/dev/null || true

echo "${APP_NAME} installed in Applications."
echo "Open with Spotlight (Zenblade) or: open -a Zenblade"
open -a "$APP_NAME" || open "$DEST_APP"
