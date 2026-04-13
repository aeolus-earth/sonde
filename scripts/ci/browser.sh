#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: bash scripts/ci/browser.sh <regression|smoke|all>
EOF
}

install_browsers() {
  local browser_args=("$@")
  if [[ "${CI:-}" == "true" && "$(uname -s)" == "Linux" ]]; then
    browser_args+=(--with-deps)
  fi
  (
    cd ui
    npx playwright install "${browser_args[@]}"
  )
}

run_regression() {
  printf '\n==> Browser regression\n'
  export VITE_SUPABASE_URL="https://utvmqjssbkzpumsdpgdy.supabase.co"
  export VITE_SUPABASE_ANON_KEY="sb_publishable_tWTyul-LMC9QDFYID8pOZA_wKM2e2AL"
  export E2E_AUTH_BYPASS_TOKEN="playwright-smoke-token"
  export VITE_AGENT_PROXY_TARGET="http://127.0.0.1:3004"
  export VITE_AGENT_WS_URL="ws://127.0.0.1:3004"

  install_browsers chromium
  (
    cd ui
    npm run test:e2e:regression
  )
}

run_smoke() {
  printf '\n==> Browser smoke\n'
  export VITE_SUPABASE_URL="https://utvmqjssbkzpumsdpgdy.supabase.co"
  export VITE_SUPABASE_ANON_KEY="sb_publishable_tWTyul-LMC9QDFYID8pOZA_wKM2e2AL"
  export E2E_AUTH_BYPASS_TOKEN="playwright-smoke-token"
  export VITE_AGENT_PROXY_TARGET="http://127.0.0.1:3004"
  export VITE_AGENT_WS_URL="ws://127.0.0.1:3004"

  install_browsers chromium firefox

  log_file="/tmp/sonde-agent-smoke.log"
  pid_file="/tmp/sonde-agent-smoke.pid"
  rm -f "$log_file" "$pid_file"

  cleanup() {
    if [[ -f "$pid_file" ]]; then
      kill "$(cat "$pid_file")" >/dev/null 2>&1 || true
      rm -f "$pid_file"
    fi
  }
  trap cleanup EXIT

  (
    cd server
    NODE_ENV=test \
    SONDE_AGENT_BACKEND=managed \
    SONDE_SERVER_PORT="3004" \
    SONDE_SKIP_CLI_PROBE="1" \
    SONDE_TEST_AGENT_MOCK="1" \
    ANTHROPIC_API_KEY=test-key \
    SONDE_MANAGED_ENVIRONMENT_ID=env_ci_browser_smoke \
    SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT="1" \
    SONDE_TEST_AUTH_DELAY_MS="100" \
    SONDE_TEST_AUTH_BYPASS_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
    SONDE_WS_TOKEN_SECRET=ci-browser-smoke-ws-secret \
    SONDE_RUNTIME_AUDIT_TOKEN=ci-browser-smoke-runtime-audit-token \
    npx tsx src/index.ts >"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )

  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3004/health >/dev/null; then
      break
    fi
    sleep 1
    if [[ "$attempt" -eq 30 ]]; then
      echo "::error::Mock agent server did not become reachable in time"
      cat "$log_file"
      exit 1
    fi
  done

  (
    cd server
    CHAT_SMOKE_HTTP_BASE="http://127.0.0.1:3004" \
    CHAT_SMOKE_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
    CHAT_SMOKE_STALE_SESSION="1" \
    CHAT_SMOKE_TIMEOUT_MS="30000" \
    node scripts/chat-smoke.mjs
  )

  (
    cd ui
    npm run test:e2e:smoke
  )
}

target="${1:-all}"

case "$target" in
  regression) run_regression ;;
  smoke) run_smoke ;;
  all)
    run_regression
    run_smoke
    ;;
  *)
    usage
    exit 1
    ;;
esac
