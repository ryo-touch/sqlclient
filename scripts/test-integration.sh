#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
project="sqlclient-integration-$$"

compose() {
  docker compose -p "$project" -f compose.integration.yml "$@"
}

cleanup() {
  result=$?
  trap - EXIT
  compose down --volumes || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose up -d --wait --wait-timeout 90
mysql_address=$(compose port mysql 3306)
postgres_address=$(compose port postgres 5432)
MYSQL_TEST_PORT="${mysql_address##*:}" POSTGRES_TEST_PORT="${postgres_address##*:}" \
  bun run integration/database.ts
