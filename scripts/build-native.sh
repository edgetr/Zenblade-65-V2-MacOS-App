#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
output="$repo_dir/build/zenbridge"

xcrun clang \
  -arch arm64 \
  -mmacosx-version-min=12.0 \
  -fobjc-arc \
  -Os \
  -framework AppKit \
  -framework AudioToolbox \
  -framework CoreAudio \
  -framework Foundation \
  "$repo_dir/native/zenbridge.m" \
  -o "$output"

chmod 755 "$output"
