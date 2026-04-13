#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: bash scripts/ci/core.sh <guard|cli|ui|server|all>
EOF
}

log_section() {
  printf '\n==> %s\n' "$1"
}

run_guard() {
  log_section "Legacy provider guard"
  bash scripts/check-legacy-provider-refs.sh

  log_section "Workflow YAML validation"
  ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].sort.each { |f| YAML.load_file(f) }; puts "workflow yaml ok"'

  log_section "Shell syntax validation"
  while IFS= read -r file; do
    bash -n "$file"
  done < <(
    {
      find scripts -type f -name '*.sh' -print
      if [[ -d .githooks ]]; then
        find .githooks -type f -print
      fi
    } | sort
  )
  echo "shell syntax ok"
}

run_cli() {
  log_section "CLI core"
  (
    cd cli
    uv lock --check
    uv run ruff check src/ tests/
    uv run ruff format --check src/ tests/
    uv run ty check src/
    uv run vulture
    uv run pytest -m "not integration" --tb=short
  )

  log_section "CLI git install smoke"
  bash scripts/ci/git-install-smoke.sh
}

run_ui() {
  log_section "UI core"
  (
    cd ui
    npm run lint
    npm run build
    npm run test
  )
}

run_server() {
  log_section "Server core"
  (
    cd server
    npm run lint
    npm test
    npm run build
  )
}

run_all() {
  run_guard
  run_cli
  run_ui
  run_server
  log_section "Hosted preflight"
  bash scripts/ci/hosted-preflight.sh
}

target="${1:-all}"

case "$target" in
  guard) run_guard ;;
  cli) run_cli ;;
  ui) run_ui ;;
  server) run_server ;;
  all) run_all ;;
  *)
    usage
    exit 1
    ;;
esac
