#!/usr/bin/env bash
# Builds every app icon artifact from the Icon Composer document
# build/icon-source/Zenblade.icon:
#   build/Assets.car   Liquid Glass icon (Default, Dark, Clear, Tinted) for macOS 26+
#   build/icon.icns    Apple-grid fallback for older macOS and Finder previews
#   build/icon.png     1024px Apple-grid PNG (824pt shape, transparent margin, shadow)
#   renderer/assets/   sidebar icon (shape only, no margin)
#   docs/images/       landing-page icon
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"
source_icon="build/icon-source/Zenblade.icon"
work="$(mktemp -d /tmp/zenblade-icons.XXXXXX)"
trap 'rm -rf "$work"' EXIT

ictool="/Applications/Icon Composer.app/Contents/Executables/ictool"
if [[ ! -x "$ictool" ]]; then
  ictool="$(xcrun --find ictool)"
fi

# 1. Native layered icon catalog with all system appearances.
xcrun actool "$source_icon" \
  --compile "$work" --output-format human-readable-text \
  --platform macosx --minimum-deployment-target 12.0 --app-icon Zenblade \
  --output-partial-info-plist "$work/icon-info.plist" >/dev/null
cp "$work/Assets.car" build/Assets.car

# 2. Render the default appearance as the bare icon shape.
"$ictool" "$source_icon" --export-image --output-file "$work/shape.png" \
  --platform macOS --rendition Default --width 1024 --height 1024 --scale 1 >/dev/null

# 3. Apple macOS grid: 824px shape centred on 1024px with the template shadow.
magick "$work/shape.png" -filter Lanczos -resize 824x824 "$work/shape-824.png"
magick -size 1024x1024 xc:none \
  \( "$work/shape-824.png" -background black -shadow 30x10+0+0 \) \
  -gravity center -geometry +0+10 -composite \
  "$work/shape-824.png" -gravity center -geometry +0+0 -composite \
  "$work/grid.png"
magick "$work/grid.png" -depth 8 -strip build/icon.png

# 4. Full-size ICNS from the grid artwork.
iconset="$work/Zenblade.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  magick build/icon.png -filter Lanczos -resize "${size}x${size}" -strip "$iconset/icon_${size}x${size}.png"
  magick build/icon.png -filter Lanczos -resize "$((size * 2))x$((size * 2))" -strip "$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o build/icon.icns

# 5. In-app and landing-page icons use the bare shape.
magick "$work/shape.png" -filter Lanczos -resize 256x256 -depth 8 -strip renderer/assets/app-icon.png
magick "$work/shape.png" -filter Lanczos -resize 64x64 -depth 8 -strip renderer/assets/app-icon-64.png
magick "$work/shape.png" -filter Lanczos -resize 256x256 -depth 8 -strip docs/images/zenblade-icon.png
