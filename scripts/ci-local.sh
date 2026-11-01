#!/usr/bin/env bash
# Run the standard gate for every npm package: npm ci, then lint, typecheck and test when the
# package defines them. Run from anywhere: bash scripts/ci-local.sh [package ...]
# Installs run first for every package because web and kb import each other's sources.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
packages=("$@")
[ ${#packages[@]} -eq 0 ] && packages=(packages/protocol web kb companion desktop)
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then echo "ci-local: Node 22 or newer is required (found $(node -v))" >&2; exit 1; fi
failed=()
for pkg in "${packages[@]}"; do
  [ -f "$root/$pkg/package-lock.json" ] || continue
  echo "== $pkg: npm ci"
  (cd "$root/$pkg" && npm ci --no-audit --no-fund) || failed+=("$pkg:install")
done
for pkg in "${packages[@]}"; do
  dir="$root/$pkg"
  [ -f "$dir/package.json" ] || { echo "ci-local: $pkg has no package.json" >&2; failed+=("$pkg"); continue; }
  echo "== $pkg"
  for script in lint typecheck test; do
    if (cd "$dir" && node -e "process.exit(require('./package.json').scripts?.['$script'] ? 0 : 1)"); then
      echo "-- $pkg: $script"
      (cd "$dir" && npm run --silent "$script") || failed+=("$pkg:$script")
    fi
  done
done
if [ ${#failed[@]} -gt 0 ]; then echo "ci-local: failed: ${failed[*]}" >&2; exit 1; fi
echo "ci-local: all packages passed"
