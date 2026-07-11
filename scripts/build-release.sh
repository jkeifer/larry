#!/usr/bin/env bash
set -euo pipefail
desc=$(git describe --tags --long 2>/dev/null) || { echo "no tags; tag a release first" >&2; exit 1; }
export LARRY_VERSION=$(printf '%s' "$desc" | sed -E 's/^v//; s/-([0-9]+)-g[0-9a-f]+$/.\1/')
echo "building larry $LARRY_VERSION" >&2
exec nix build --impure "$@"
