#!/bin/bash
# Migrations + pgTAP without Docker: a throwaway Postgres 16 cluster with minimal Supabase
# stand-ins (roles, auth.uid(), auth.users, cron.schedule). Use when `npm run db:start`
# isn't available; `npm run db:test` against the real local stack is still the reference.
#   scripts/db-without-docker/run.sh            reset + all tests
#   scripts/db-without-docker/run.sh 21_*.sql   reset + matching tests
# Needs: Postgres 16 server binaries and pgTAP (apt: postgresql-16 postgresql-16-pgtap).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}; PORT=${PG_PORT:-54329}
DATA=${PG_DATA:-/var/lib/postgresql/ag-test-data}
run_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "$BIN/pg_ctl -D $DATA stop -m fast" >/dev/null 2>&1 || true
rm -rf "$DATA"; mkdir -p "$DATA"; [ "$(id -u)" = 0 ] && chown postgres "$DATA"
run_pg "$BIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
run_pg "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/../ag-test.log start" >/dev/null
sleep 2
P="psql -h /tmp -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X"
$P -f "$HERE/stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  if ! sed 's/^create extension if not exists pg_cron with schema pg_catalog;/-- pg_cron is stubbed here/' "$f" | $P >/tmp/ag-migration.out 2>&1; then
    echo "migration failed: $(basename "$f")"; tail -5 /tmp/ag-migration.out; exit 1
  fi
done
echo "migrations: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) applied"
cd "$ROOT/supabase/tests"
fail=0; total=0
for f in ${1:-[0-9]*.test.sql}; do
  out=$(psql -h /tmp -p $PORT -U postgres -d postgres -X -q -t -A -f "$f" 2>&1)
  ok=$(grep -c "^ok " <<<"$out" || true); bad=$(grep -c "^not ok" <<<"$out" || true); err=$(grep -m3 "ERROR" <<<"$out" || true)
  total=$((total + ok + bad))
  if [ "$bad" -gt 0 ] || [ -n "$err" ]; then fail=1; echo "FAIL $f ($bad failed)"; grep -A4 "^not ok" <<<"$out" | head -20; [ -n "$err" ] && echo "$err"
  else echo "ok   $f ($ok)"; fi
done
echo "assertions: $total"; exit $fail
