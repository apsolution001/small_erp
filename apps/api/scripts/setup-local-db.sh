#!/usr/bin/env bash
# Creates the Ekaro DB roles and databases (dev + test) on a local or docker Postgres.
# Idempotent. Usage: setup-local-db.sh [extra_db_name ...]
set -euo pipefail

PSQL_ADMIN_URL="${PSQL_ADMIN_URL:-}"
run_psql() {
  if [ -n "$PSQL_ADMIN_URL" ]; then psql "$PSQL_ADMIN_URL" -v ON_ERROR_STOP=1 "$@"
  elif command -v sudo >/dev/null && id postgres >/dev/null 2>&1; then sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
  else psql "postgres://postgres:postgres@localhost:5432/postgres" -v ON_ERROR_STOP=1 "$@"
  fi
}

run_psql -q <<'SQL'
do $$
begin
  if not exists (select from pg_roles where rolname = 'ekaro_owner') then
    create role ekaro_owner login password 'ekaro_owner' createdb;
  end if;
  if not exists (select from pg_roles where rolname = 'ekaro_app') then
    create role ekaro_app login password 'ekaro_app' nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'ekaro_platform') then
    create role ekaro_platform login password 'ekaro_platform' nobypassrls;
  end if;
end $$;
SQL

for db in ekaro ekaro_test "$@"; do
  exists=$(run_psql -tAc "select 1 from pg_database where datname = '$db'")
  if [ "$exists" != "1" ]; then
    run_psql -q -c "create database \"$db\" owner ekaro_owner"
  fi
  run_psql -q -d "$db" -c "revoke all on schema public from public; grant usage on schema public to ekaro_app, ekaro_platform; alter schema public owner to ekaro_owner;"
done
echo "local databases ready: ekaro ekaro_test $*"
