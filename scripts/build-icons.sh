#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"
icon_output="$(mktemp -d /tmp/zenblade-icons.XXXXXX)"
trap 'rm -rf "$icon_output"' EXIT

# Compile the editable Icon Composer layers with Apple's material renderer.
# Assets.car enables native appearances; ICNS supplies the older macOS fallback.
xcrun actool build/icon-source/Zenblade.icon \
  --compile "$icon_output" --output-format human-readable-text \
  --platform macosx --minimum-deployment-target 12.0 --app-icon Zenblade \
  --output-partial-info-plist "$icon_output/icon-info.plist"
cp "$icon_output/Assets.car" build/Assets.car
cp "$icon_output/Zenblade.icns" build/icon.icns
