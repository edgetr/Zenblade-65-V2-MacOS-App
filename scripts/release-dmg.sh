#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"

npm run build

version="$(node -p 'require("./package.json").version')"
artifact="Zenblade-${version}-arm64.dmg"
stage_dir="$(mktemp -d /tmp/zenblade-release.XXXXXX)"
trap 'rm -rf "$stage_dir"' EXIT
staged_app="$stage_dir/Zenblade.app"

# Sign a clean copy outside Desktop/iCloud, which can add incompatible xattrs.
ditto --noextattr --norsrc dist/mac-arm64/Zenblade.app "$staged_app"
xattr -cr "$staged_app"
codesign --force --sign - "$staged_app/Contents/Resources/zenbridge"
codesign --force --deep --sign - "$staged_app"
codesign --verify --deep --strict "$staged_app"
CSC_IDENTITY_AUTO_DISCOVERY=false npx --no-install electron-builder \
  --mac dmg --arm64 --prepackaged "$staged_app" --publish never
hdiutil verify "dist/$artifact"
(cd dist && shasum -a 256 "$artifact" > "$artifact.sha256")
echo "Release ready: dist/$artifact"
