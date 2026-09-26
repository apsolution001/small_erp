#!/usr/bin/env bash
# Prepares a Claude Code session: dependencies installed, local Postgres/Redis up (cloud sessions only).
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  command -v pg_ctlcluster >/dev/null 2>&1 && (service postgresql start >/dev/null 2>&1 || true)
  command -v redis-server >/dev/null 2>&1 && (redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null)
  if [ -f apps/api/scripts/setup-local-db.sh ]; then
    bash apps/api/scripts/setup-local-db.sh >/dev/null 2>&1 || echo "warn: local db setup failed" >&2
  fi
fi

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || pnpm install >/dev/null 2>&1 || echo "warn: pnpm install failed" >&2
fi

exit 0
