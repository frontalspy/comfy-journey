#!/usr/bin/env bash
# Builds comfy-<version>.tar.gz: everything needed to run Comfy without a build step.
# Usage: scripts/package-release.sh <version> [output-dir]   (run `npm run build` first)
set -euo pipefail

version="${1:?usage: package-release.sh <version> [output-dir]}"
out="${2:-.}"
name="comfy-${version}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

for built in shared/dist server/dist web/dist; do
  [ -d "$built" ] || { echo "Missing $built: run npm run build first." >&2; exit 1; }
done

mkdir -p "$stage/$name"
cp package.json package-lock.json LICENSE NOTICE README.md CHANGELOG.md .env.example .nvmrc "$stage/$name/"
cp -r docs workflows comfyui-extension "$stage/$name/"
for workspace in shared server web; do
  mkdir -p "$stage/$name/$workspace"
  cp "$workspace/package.json" "$stage/$name/$workspace/"
  cp -r "$workspace/dist" "$stage/$name/$workspace/"
done
# Test files are not needed to run the app.
find "$stage/$name/server/dist" -name '*.test.*' -delete

tar -czf "$stage/$name.tar.gz" -C "$stage" "$name"
mkdir -p "$out"
mv "$stage/$name.tar.gz" "$out/"
echo "$out/$name.tar.gz"
