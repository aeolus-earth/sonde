#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

legacy_pattern='rail'"'"'way|day'"'"'tona'

matches="$(
  rg -n -i "$legacy_pattern" . \
    --glob '!**/node_modules/**' \
    --glob '!**/.git/**' \
    --glob '!**/dist/**' \
    --glob '!**/playwright-report/**' \
    --glob '!**/test-results/**' \
    --glob '!repos/deepagents/**' \
    --glob '!tickets/**' \
    --glob '!notes/**' \
    --glob '!AGENTS-repo-exploration.md' \
    --glob '!**/*.png' \
    --glob '!**/*.svg' \
    || true
)"

if [[ -n "$matches" ]]; then
  echo "::error::Found legacy provider references in active first-party paths"
  echo "$matches"
  exit 1
fi

echo "No legacy provider references found in active first-party paths."
