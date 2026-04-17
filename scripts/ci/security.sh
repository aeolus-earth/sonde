#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

printf '\n==> Security regression harness\n'

SNAPSHOT_OUT="${SONDE_SECURITY_SNAPSHOT_OUT:-${RUNNER_TEMP:-/tmp}/sonde-rls-snapshot.txt}"
ASSUME_READY="${SONDE_SECURITY_ASSUME_READY:-0}"

psql_file() {
  local file="$1"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=postgres psql \
      -h 127.0.0.1 \
      -p 54322 \
      -U postgres \
      -d postgres \
      -v ON_ERROR_STOP=1 \
      -f "$file"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    local container
    container="$(
      docker ps --format '{{.Names}}' | awk '/^supabase_db_/ { print; exit }'
    )"
    if [[ -n "$container" ]]; then
      docker exec -i "$container" psql \
        -U postgres \
        -d postgres \
        -v ON_ERROR_STOP=1 \
        -f /dev/stdin <"$file"
      return 0
    fi
  fi

  echo "::error::Unable to query the local Supabase Postgres instance. Install psql or ensure Docker can see the supabase_db_* container."
  exit 1
}

cleanup() {
  if [[ "$ASSUME_READY" != "1" ]]; then
    supabase stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

capture_snapshot() {
  mkdir -p "$(dirname "$SNAPSHOT_OUT")"
  if psql_file scripts/security/rls-snapshot.sql >"$SNAPSHOT_OUT"; then
    echo "RLS snapshot written to $SNAPSHOT_OUT"
  else
    echo "::warning::Could not capture RLS snapshot at $SNAPSHOT_OUT"
  fi
}

if [[ "$ASSUME_READY" != "1" ]]; then
  supabase start
  bash scripts/ci/question-graph-migration.sh
  supabase db reset --local --yes
fi

if ! psql_file scripts/security/rls-exploit-tests.sql; then
  capture_snapshot
  exit 1
fi

capture_snapshot
