#!/usr/bin/env bash
# Local preview for the summarize docs site.
# Usage:
#   scripts/docs-serve.sh                # serves on http://127.0.0.1:4000
#   PORT=4001 scripts/docs-serve.sh
#
# Rebuilds on every run; reload the browser after editing markdown.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4000}"

cd "$REPO_ROOT"
node scripts/build-docs-site.mjs

OUT_DIR="$REPO_ROOT/dist/docs-site"
echo "-> serving $OUT_DIR on http://127.0.0.1:${PORT}"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$OUT_DIR"
