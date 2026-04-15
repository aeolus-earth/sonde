#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

printf '\n==> Data integration\n'

query_postgres() {
  local sql="$1"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=postgres psql \
      -h 127.0.0.1 \
      -p 54322 \
      -U postgres \
      -d postgres \
      -tAc "$sql"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    local container
    container="$(
      docker ps --format '{{.Names}}' | awk '/^supabase_db_/ { print; exit }'
    )"
    if [[ -n "$container" ]]; then
      docker exec "$container" psql -U postgres -d postgres -tAc "$sql"
      return 0
    fi
  fi

  echo "::error::Unable to query the local Supabase Postgres instance. Install psql or ensure Docker can see the supabase_db_* container."
  exit 1
}

cleanup() {
  supabase stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_status_json() {
  local attempt

  for attempt in $(seq 1 20); do
    if status_json="$(supabase status --output json 2>/tmp/sonde-supabase-status.err)"; then
      printf '%s\n' "$status_json"
      return 0
    fi
    sleep 2
  done

  echo "::error::supabase status did not become ready after reset"
  cat /tmp/sonde-supabase-status.err || true
  exit 1
}

supabase start
bash scripts/ci/question-graph-migration.sh
supabase db reset --local --yes

status_json="$(wait_for_status_json)"
SB_URL="$(node -e 'const body = JSON.parse(process.argv[1]); console.log(body.API_URL);' "$status_json")"
SB_ANON_KEY="$(node -e 'const body = JSON.parse(process.argv[1]); console.log(body.ANON_KEY);' "$status_json")"
SB_SERVICE_ROLE_KEY="$(node -e 'const body = JSON.parse(process.argv[1]); console.log(body.SERVICE_ROLE_KEY);' "$status_json")"

VERSION="$(
  curl -sf \
    -H "apikey: $SB_ANON_KEY" \
    -H "Authorization: Bearer $SB_ANON_KEY" \
    "$SB_URL/rest/v1/rpc/get_schema_version"
)"
echo "Schema version: $VERSION"
test "$VERSION" -ge 1

file_count="$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
applied_count="$(query_postgres "SELECT count(*) FROM supabase_migrations.schema_migrations")"

echo "Migration files: $file_count, Applied: $applied_count"
if [[ "$file_count" != "$applied_count" ]]; then
  echo "::error::Migration count mismatch: $file_count files but $applied_count applied"
  exit 1
fi

(
  cd cli
  uv sync
  AEOLUS_SUPABASE_URL="$SB_URL" \
  AEOLUS_SUPABASE_ANON_KEY="$SB_ANON_KEY" \
  AEOLUS_SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY" \
  uv run pytest -m integration --tb=short
)
