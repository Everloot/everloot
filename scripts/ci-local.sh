#!/usr/bin/env bash
# Run the standard gate for every npm package: npm ci, then lint, typecheck and test when the
# package defines them, then the web build. Run from anywhere:
#   bash scripts/ci-local.sh [--skip-build] [package ...]
# Works on bash 3.2 (macOS): no associative arrays.
# Installs run first for every package because web and kb import each other's sources.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
build=1
packages=()
for arg in "$@"; do
  case "$arg" in
    --skip-build) build=0 ;;
    *) arg="${arg%/}"; while [ "${arg%/}" != "$arg" ]; do arg="${arg%/}"; done; packages+=("$arg") ;;
  esac
done
[ ${#packages[@]} -eq 0 ] && packages=(packages/protocol web kb companion desktop)
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then echo "ci-local: Node 22 or newer is required (found $(node -v))" >&2; exit 1; fi
failed=()
broken=" "
for pkg in "${packages[@]}"; do
  dir="$root/$pkg"
  if [ ! -f "$dir/package.json" ]; then echo "ci-local: $pkg has no package.json" >&2; failed+=("$pkg:missing"); broken="$broken$pkg "; continue; fi
  if [ ! -f "$dir/package-lock.json" ]; then echo "ci-local: $pkg has no package-lock.json; npm ci needs one" >&2; failed+=("$pkg:no-lockfile"); broken="$broken$pkg "; continue; fi
  echo "== $pkg: npm ci"
  (cd "$dir" && npm ci --no-audit --no-fund) || { failed+=("$pkg:install"); broken="$broken$pkg "; }
done
for pkg in "${packages[@]}"; do
  if [[ "$broken" == *" $pkg "* ]]; then echo "== $pkg: skipped (install failed or missing)"; continue; fi
  dir="$root/$pkg"
  echo "== $pkg"
  steps=(lint typecheck test)
  [ "$pkg" = web ] && [ "$build" -eq 1 ] && steps+=(build)
  for script in "${steps[@]}"; do
    if (cd "$dir" && node -e "process.exit(require('./package.json').scripts?.['$script'] ? 0 : 1)"); then
      echo "-- $pkg: $script"
      (cd "$dir" && npm run --silent "$script") || failed+=("$pkg:$script")
    fi
  done
done
if [ ${#failed[@]} -gt 0 ]; then echo "ci-local: failed: ${failed[*]}" >&2; exit 1; fi
echo "ci-local: all packages passed"
