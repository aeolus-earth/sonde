#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

NORMALIZATION_MIGRATION="20260414000002_repair_question_graph_primary_links.sql"

psql_sql() {
  local db="$1"
  local sql="$2"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=postgres psql \
      -h 127.0.0.1 \
      -p 54322 \
      -U postgres \
      -d "$db" \
      -v ON_ERROR_STOP=1 \
      -c "$sql"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    local container
    container="$(
      docker ps --format '{{.Names}}' | awk '/^supabase_db_/ { print; exit }'
    )"
    if [[ -n "$container" ]]; then
      docker exec "$container" psql \
        -U postgres \
        -d "$db" \
        -v ON_ERROR_STOP=1 \
        -c "$sql"
      return 0
    fi
  fi

  echo "::error::Unable to execute SQL against the local Supabase Postgres instance."
  exit 1
}

psql_file() {
  local db="$1"
  local file="$2"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=postgres psql \
      -h 127.0.0.1 \
      -p 54322 \
      -U postgres \
      -d "$db" \
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
        -d "$db" \
        -v ON_ERROR_STOP=1 < "$file"
      return 0
    fi
  fi

  echo "::error::Unable to execute SQL files against the local Supabase Postgres instance."
  exit 1
}

psql_query_value() {
  local db="$1"
  local sql="$2"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=postgres psql \
      -h 127.0.0.1 \
      -p 54322 \
      -U postgres \
      -d "$db" \
      -v ON_ERROR_STOP=1 \
      -tAc "$sql"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    local container
    container="$(
      docker ps --format '{{.Names}}' | awk '/^supabase_db_/ { print; exit }'
    )"
    if [[ -n "$container" ]]; then
      docker exec "$container" psql \
        -U postgres \
        -d "$db" \
        -v ON_ERROR_STOP=1 \
        -tAc "$sql"
      return 0
    fi
  fi

  echo "::error::Unable to query the local Supabase Postgres instance."
  exit 1
}

create_temp_db() {
  local db="$1"
  psql_sql postgres "DROP DATABASE IF EXISTS ${db} WITH (FORCE);"
  psql_sql postgres "CREATE DATABASE ${db};"
  psql_sql "$db" "
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY
    );
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS \$\$
      SELECT NULL::uuid;
    \$\$;
    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    AS \$\$
      SELECT '{}'::jsonb;
    \$\$;

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public BOOLEAN NOT NULL DEFAULT false,
      file_size_limit BIGINT
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY,
      bucket_id TEXT NOT NULL,
      name TEXT NOT NULL,
      owner UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE OR REPLACE FUNCTION extensions.sign(payload jsonb, secret text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    AS \$\$
      SELECT 'stub.jwt'::text;
    \$\$;
  "
}

drop_temp_db() {
  local db="$1"
  psql_sql postgres "DROP DATABASE IF EXISTS ${db} WITH (FORCE);"
}

apply_migrations_through() {
  local db="$1"
  local stop_file="$2"
  local file

  while IFS= read -r file; do
    psql_file "$db" "$file"
    if [[ "$(basename "$file")" == "$stop_file" ]]; then
      break
    fi
  done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local message="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "::error::${message}: expected '${expected}', got '${actual}'"
    exit 1
  fi
}

run_question_graph_backfill_regression() {
  local db="sonde_question_graph_backfill"
  create_temp_db "$db"
  trap 'drop_temp_db "$db"' RETURN

  apply_migrations_through "$db" "20260411000001_managed_session_costs.sql"

  psql_sql "$db" "
    INSERT INTO directions (id, program, title, question, status, source, created_at, updated_at)
    VALUES (
      'DIR-001',
      'weather-intervention',
      'Cloud-seeding direction',
      'Which question should anchor this direction?',
      'active',
      'human/test',
      '2026-04-01T00:00:00Z',
      '2026-04-01T00:00:00Z'
    );

    INSERT INTO experiments (id, program, status, source, direction_id, created_at, updated_at)
    VALUES (
      'EXP-0179',
      'weather-intervention',
      'open',
      'human/test',
      'DIR-001',
      '2026-04-02T00:00:00Z',
      '2026-04-02T00:00:00Z'
    );

    INSERT INTO questions (
      id,
      program,
      question,
      status,
      source,
      promoted_to_type,
      promoted_to_id,
      created_at,
      updated_at
    )
    VALUES
      (
        'Q-0001',
        'weather-intervention',
        'Older promoted question',
        'promoted',
        'human/test',
        'experiment',
        'EXP-0179',
        '2026-04-03T00:00:00Z',
        '2026-04-03T00:00:00Z'
      ),
      (
        'Q-0002',
        'weather-intervention',
        'Newer promoted question',
        'promoted',
        'human/test',
        'experiment',
        'EXP-0179',
        '2026-04-04T00:00:00Z',
        '2026-04-04T00:00:00Z'
      );
  "

  psql_file "$db" "supabase/migrations/20260412000001_question_graph.sql"

  assert_equals \
    "$(psql_query_value "$db" "SELECT count(*) FROM question_experiments WHERE experiment_id = 'EXP-0179';")" \
    "2" \
    "question_graph should preserve every promoted question link"
  assert_equals \
    "$(psql_query_value "$db" "SELECT count(*) FROM question_experiments WHERE experiment_id = 'EXP-0179' AND is_primary;")" \
    "1" \
    "question_graph should assign exactly one primary question per experiment"
  assert_equals \
    "$(psql_query_value "$db" "SELECT question_id FROM question_experiments WHERE experiment_id = 'EXP-0179' AND is_primary;")" \
    "Q-0001" \
    "question_graph should choose the oldest promoted question when no explicit primary exists"

  trap - RETURN
  drop_temp_db "$db"
}

run_question_graph_normalization_regression() {
  local db="sonde_question_graph_repair"
  create_temp_db "$db"
  trap 'drop_temp_db "$db"' RETURN

  apply_migrations_through "$db" "20260414000001_create_device_auth_requests.sql"

  psql_sql "$db" "
    INSERT INTO directions (
      id,
      program,
      title,
      question,
      status,
      source,
      created_at,
      updated_at
    )
    VALUES (
      'DIR-002',
      'weather-intervention',
      'Repair direction',
      'Which linked question should be primary?',
      'active',
      'human/test',
      '2026-04-05T00:00:00Z',
      '2026-04-05T00:00:00Z'
    );

    INSERT INTO experiments (id, program, status, source, direction_id, created_at, updated_at)
    VALUES (
      'EXP-0180',
      'weather-intervention',
      'open',
      'human/test',
      'DIR-002',
      '2026-04-06T00:00:00Z',
      '2026-04-06T00:00:00Z'
    );

    INSERT INTO questions (
      id,
      program,
      question,
      status,
      source,
      promoted_to_type,
      promoted_to_id,
      direction_id,
      created_at,
      updated_at
    )
    VALUES
      (
        'Q-0010',
        'weather-intervention',
        'Existing linked question',
        'investigating',
        'human/test',
        'experiment',
        'EXP-0180',
        'DIR-002',
        '2026-04-07T00:00:00Z',
        '2026-04-07T00:00:00Z'
      ),
      (
        'Q-0011',
        'weather-intervention',
        'Direction primary question',
        'investigating',
        'human/test',
        'experiment',
        'EXP-0180',
        'DIR-002',
        '2026-04-08T00:00:00Z',
        '2026-04-08T00:00:00Z'
      );

    UPDATE directions
    SET primary_question_id = 'Q-0011'
    WHERE id = 'DIR-002';

    INSERT INTO question_experiments (question_id, experiment_id, is_primary)
    VALUES ('Q-0010', 'EXP-0180', false);
  "

  psql_file "$db" "supabase/migrations/${NORMALIZATION_MIGRATION}"

  assert_equals \
    "$(psql_query_value "$db" "SELECT count(*) FROM question_experiments WHERE experiment_id = 'EXP-0180';")" \
    "2" \
    "repair migration should backfill missing promoted question links"
  assert_equals \
    "$(psql_query_value "$db" "SELECT count(*) FROM question_experiments WHERE experiment_id = 'EXP-0180' AND is_primary;")" \
    "1" \
    "repair migration should assign exactly one primary question when one is missing"
  assert_equals \
    "$(psql_query_value "$db" "SELECT question_id FROM question_experiments WHERE experiment_id = 'EXP-0180' AND is_primary;")" \
    "Q-0011" \
    "repair migration should prefer the direction primary question when repairing missing primaries"

  trap - RETURN
  drop_temp_db "$db"
}

printf '\n==> Question graph migration regressions\n'
run_question_graph_backfill_regression
run_question_graph_normalization_regression
