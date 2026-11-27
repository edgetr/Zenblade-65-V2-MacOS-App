#!/usr/bin/env bash
# Stages the renderer and shared data as the Tauri frontend (tauri://localhost/).
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo_dir/build/web"
rm -rf "$out"
mkdir -p "$out"
cp -R "$repo_dir/renderer" "$out/renderer"
mkdir -p "$out/shared"
cp "$repo_dir/shared/device-ids.json" "$out/shared/"
