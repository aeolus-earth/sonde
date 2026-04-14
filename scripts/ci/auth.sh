#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

printf '\n==> Managed auth parity\n'

wait_for_status_json() {
  local attempt

  for attempt in $(seq 1 20); do
    if status_json="$(supabase status --output json 2>/tmp/sonde-supabase-auth-status.err)"; then
      printf '%s\n' "$status_json"
      return 0
    fi
    sleep 2
  done

  echo "::error::supabase status did not become ready for auth parity checks"
  cat /tmp/sonde-supabase-auth-status.err || true
  exit 1
}

wait_for_server() {
  local url="$1"
  local log_file="$2"
  local attempt

  for attempt in $(seq 1 30); do
    if curl -fsS "$url/health" >/dev/null 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "::error::Managed auth parity server did not become reachable in time"
  cat "$log_file" || true
  exit 1
}

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
  fi
  rm -f "${session_file:-}" "${server_log:-}"
  supabase stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

supabase start
supabase db reset --local --yes

status_json="$(wait_for_status_json)"
SB_URL="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.API_URL);' "$status_json")"
SB_ANON_KEY="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.ANON_KEY);' "$status_json")"
SB_SERVICE_ROLE_KEY="$(node -e 'const body = JSON.parse(process.argv[1]); process.stdout.write(body.SERVICE_ROLE_KEY);' "$status_json")"

(
  cd cli
  uv sync
)

session_file="$(mktemp "${TMPDIR:-/tmp}/sonde-managed-auth-session.XXXXXX.json")"
server_log="$(mktemp "${TMPDIR:-/tmp}/sonde-managed-auth-server.XXXXXX.log")"
server_pid=""

SMOKE_EMAIL="${SMOKE_USER_EMAIL:-smoke-auth@aeolus.earth}"
SMOKE_PASSWORD="${SMOKE_USER_PASSWORD:-smoke-auth-password}"

(
  cd server
  SUPABASE_URL="$SB_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY" \
  SMOKE_USER_EMAIL="$SMOKE_EMAIL" \
  SMOKE_USER_PASSWORD="$SMOKE_PASSWORD" \
  SMOKE_USER_PROGRAMS="${SMOKE_USER_PROGRAMS:-shared}" \
  node scripts/provision-smoke-user.mjs >/dev/null

  SUPABASE_URL="$SB_URL" \
  SUPABASE_ANON_KEY="$SB_ANON_KEY" \
  SMOKE_USER_EMAIL="$SMOKE_EMAIL" \
  SMOKE_USER_PASSWORD="$SMOKE_PASSWORD" \
  SMOKE_SESSION_FILE="$session_file" \
  node scripts/mint-smoke-session.mjs >/dev/null
)

smoke_token="$(node -e 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write((data.access_token ?? "").trim());' "$session_file")"
if [[ -z "$smoke_token" ]]; then
  echo "::error::Managed auth parity could not extract an access token from $session_file"
  exit 1
fi

pushd server >/dev/null
NODE_ENV=test \
SONDE_AGENT_BACKEND=managed \
SONDE_SERVER_PORT="${SONDE_AUTH_TEST_PORT:-3005}" \
SONDE_SKIP_CLI_PROBE="1" \
SONDE_TEST_AGENT_MOCK="1" \
SONDE_TEST_AUTH_BYPASS_TOKEN="$smoke_token" \
SONDE_TEST_AUTH_DELAY_MS="25" \
SONDE_TEST_MANAGED_MOCK_TOOL="${SONDE_TEST_MANAGED_MOCK_TOOL:-sonde_status}" \
SONDE_TEST_MANAGED_MOCK_FINAL_TEXT="${SONDE_TEST_MANAGED_MOCK_FINAL_TEXT:-SONDE_SMOKE_OK}" \
ANTHROPIC_API_KEY=test-key \
SONDE_MANAGED_ENVIRONMENT_ID=env_ci_auth_parity \
SONDE_MANAGED_ALLOW_EPHEMERAL_AGENT="1" \
SUPABASE_URL="$SB_URL" \
SUPABASE_ANON_KEY="$SB_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY" \
npx tsx src/index.ts >"$server_log" 2>&1 &
server_pid=$!
popd >/dev/null

wait_for_server "http://127.0.0.1:${SONDE_AUTH_TEST_PORT:-3005}" "$server_log"

(
  cd server
  MANAGED_AUTH_AUDIT_HTTP_BASE="http://127.0.0.1:${SONDE_AUTH_TEST_PORT:-3005}" \
  MANAGED_AUTH_AUDIT_SESSION_FILE="$session_file" \
  MANAGED_AUTH_AUDIT_PROMPT="Use Sonde tools to inspect status and then reply with SONDE_SMOKE_OK." \
  MANAGED_AUTH_AUDIT_EXPECT_SUBSTRING="SONDE_SMOKE_OK" \
  MANAGED_AUTH_AUDIT_REQUIRE_TOOL_USE="1" \
  node scripts/run-managed-auth-audit.mjs
)
