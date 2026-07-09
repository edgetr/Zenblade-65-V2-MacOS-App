#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:${HOME}/.local/bin:${PATH}"
export CSC_IDENTITY_AUTO_DISCOVERY=false

APP_NAME="Zenblade"
SRC_APP="$ROOT/dist/mac-arm64/${APP_NAME}.app"
DEST_APP="/Applications/${APP_NAME}.app"

echo "Building ${APP_NAME}..."
npm install --silent
npx electron-builder --mac dir --arm64

if [[ ! -d "$SRC_APP" ]]; then
  echo "Build failed: missing $SRC_APP" >&2
  exit 1
fi

xattr -cr "$SRC_APP" 2>/dev/null || true

echo "Installing to ${DEST_APP}..."
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 0.4
pkill -x "$APP_NAME" 2>/dev/null || true
osascript -e 'tell application "Zenblade Control" to quit' 2>/dev/null || true
pkill -x "Zenblade Control" 2>/dev/null || true
sleep 0.3

rm -rf "$DEST_APP"
rm -rf "/Applications/Zenblade Control.app" 2>/dev/null || true
cp -R "$SRC_APP" "$DEST_APP"
xattr -cr "$DEST_APP" 2>/dev/null || true

echo "${APP_NAME} installed in Applications."
echo "Open with Spotlight (Zenblade) or: open -a Zenblade"
open -a "$APP_NAME" || open "$DEST_APP"
