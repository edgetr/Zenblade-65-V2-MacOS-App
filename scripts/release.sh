#!/usr/bin/env bash
# Builds a signed release: DMG + checksum for new installs, and the signed
# updater bundle + latest.json that installed apps fetch from GitHub.
#
#   npm run release            build into dist/
#   npm run release:publish    build, then create the GitHub release
#
# Needs the updater private key (default ~/.tauri/zenblade-updater.key, or
# TAURI_SIGNING_PRIVATE_KEY as a path or the key itself) and its password
# (TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or the login Keychain item
# "zenblade-updater-key"). Keep both secret and backed up: installed apps only
# accept updates signed with this key.
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"

publish=false
[[ "${1:-}" == "--publish" ]] && publish=true

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Releases are built on Apple silicon (arm64) only." >&2
  exit 1
fi

version="$(node -p 'require("./package.json").version')"
tag="v${version}"
repo="edgetr/Zenblade-65-V2-MacOS-App"
notes="docs/releases/${tag}.md"
[[ -f "$notes" ]] || { echo "Missing release notes: $notes" >&2; exit 1; }

export TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$HOME/.tauri/zenblade-updater.key}"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a "$USER" -s zenblade-updater-key -w 2>/dev/null)" || {
    echo "Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD or add the zenblade-updater-key Keychain item." >&2
    exit 1
  }
fi
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if [[ "$TAURI_SIGNING_PRIVATE_KEY" != *"untrusted comment"* && ! -f "$TAURI_SIGNING_PRIVATE_KEY" ]]; then
  echo "Updater signing key not found: $TAURI_SIGNING_PRIVATE_KEY" >&2
  exit 1
fi

bundle="src-tauri/target.nosync/release/bundle"
rm -rf "$bundle"   # never ship a stale artifact from an earlier build

npm run build:icons
npx --no-install tauri build --bundles app,dmg \
  --config '{"bundle":{"createUpdaterArtifacts":true}}'

codesign --verify --deep --strict "$bundle/macos/Zenblade.app"
dmg="$bundle/dmg/Zenblade_${version}_aarch64.dmg"
[[ -f "$dmg" ]] || { echo "Missing $dmg" >&2; exit 1; }

# The update archive must contain a bundle whose signature still verifies.
check_dir="$(mktemp -d /tmp/zenblade-release-check.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT
tar -xzf "$bundle/macos/Zenblade.app.tar.gz" -C "$check_dir"
codesign --verify --deep --strict "$check_dir/Zenblade.app"
# requireSignedVersion: the signature's trusted comment must carry this version.
base64 -D -i "$bundle/macos/Zenblade.app.tar.gz.sig" | grep -q "version:${version}" || \
  base64 -D -i "$bundle/macos/Zenblade.app.tar.gz.sig" | grep -q "\"version\":\"${version}\"" || \
  { echo "Update signature does not record version ${version}" >&2; base64 -D -i "$bundle/macos/Zenblade.app.tar.gz.sig" | sed -n '3p' >&2; exit 1; }
artifact="Zenblade-${version}-arm64.dmg"
update="Zenblade-${version}-arm64.app.tar.gz"

mkdir -p dist
rm -f "dist/$artifact" "dist/$artifact.sha256" "dist/$update" "dist/$update.sig" dist/latest.json
cp "$dmg" "dist/$artifact"
cp "$bundle/macos/Zenblade.app.tar.gz" "dist/$update"
cp "$bundle/macos/Zenblade.app.tar.gz.sig" "dist/$update.sig"
hdiutil verify "dist/$artifact" >/dev/null
(cd dist && shasum -a 256 "$artifact" > "$artifact.sha256")

# Installed apps read this manifest from the newest release.
node - "$version" "$tag" "$repo" "$notes" "dist/$update" <<'NODE'
const fs = require("fs");
const [version, tag, repo, notesFile, update] = process.argv.slice(2);
const notes = fs.readFileSync(notesFile, "utf8")
  .split("\n").filter((line) => !line.startsWith("#")).join("\n").trim();
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: fs.readFileSync(`${update}.sig`, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${update.split("/").pop()}`,
    },
  },
};
fs.writeFileSync("dist/latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "Release ready in dist/: $artifact, $update, latest.json"

if $publish; then
  gh release create "$tag" \
    "dist/$artifact" "dist/$artifact.sha256" "dist/$update" "dist/$update.sig" dist/latest.json \
    --repo "$repo" --title "Zenblade ${version}" --notes-file "$notes" --latest
  echo "Published $tag"
fi
