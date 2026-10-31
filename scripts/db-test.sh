#!/usr/bin/env bash
# Runs supabase/migrations and supabase/tests against a THROWAWAY database on a LOCAL Postgres.
# Auth and Storage are replaced by stubs (supabase/tests/00_supabase_stubs.sql), so this validates
# SQL, constraints, RLS, privileges and function logic on a real Postgres engine.
# It is NOT a Supabase project: GoTrue, the Storage HTTP API, PostgREST and email are not exercised.
#
# Usage: PGHOST=localhost PGUSER=postgres PGPASSWORD=... bash scripts/db-test.sh
set -euo pipefail
case "${PGHOST:-localhost}" in localhost|127.0.0.1|::1|/*) ;; *) echo "Refusing to run: PGHOST must be a local Postgres." >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="lovoki_stub_test_$$_$RANDOM"
admin() { PGDATABASE=postgres psql -v ON_ERROR_STOP=1 -q "$@"; }
run()   { PGDATABASE="$DB" psql -v ON_ERROR_STOP=1 -q "$@"; }
admin -c "create database \"$DB\""
trap 'admin -c "drop database if exists \"$DB\"" >/dev/null 2>&1 || true' EXIT
run -f "$ROOT/supabase/tests/00_supabase_stubs.sql"
# Only the Phase 2 migration runs on the stubs. Phase 3 needs real Auth/Storage: see npm run test:integration.
for f in "$ROOT"/supabase/migrations/*phase2_foundation.sql; do echo "applying $(basename "$f")"; run -f "$f"; done
run -f "$ROOT/supabase/tests/10_rls.sql" 2>&1 | tee /tmp/lovoki-db-test.log | grep -E "PASS|ERROR|ASSERT|FAILED|expected" || true
grep -q "ALL DATABASE TESTS PASSED" /tmp/lovoki-db-test.log || { echo "DATABASE TESTS FAILED"; cat /tmp/lovoki-db-test.log | tail -20; exit 1; }
echo "PASS count: $(grep -c 'PASS:' /tmp/lovoki-db-test.log)"
