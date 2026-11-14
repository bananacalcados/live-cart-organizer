#!/usr/bin/env bash
set -euo pipefail
# Private Unix socket, no TCP listener, explicit user/database: never production.
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d /tmp/live-shown-regression.XXXXXX)"
runner=()
db_user="$(id -un)"
if [ "$(id -u)" = 0 ]; then
  chown nobody:nogroup "$tmp"
  runner=(runuser -u nobody --)
  db_user=nobody
fi
cleanup() {
  "${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
pg_bin="$(dirname "$(readlink -f "$(command -v initdb)")")"
pg_lib="$(dirname "$pg_bin")/lib"
# Nix binaries reached through /usr/bin need the actual extension directory.
"${runner[@]}" "$pg_bin/initdb" -D "$tmp/data" -A trust --no-locale >"$tmp/init.log"
"${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -l "$tmp/server.log" -o "-k $tmp -p 5432 -c listen_addresses='' -c dynamic_library_path=$pg_lib" -w start >/dev/null
psql -X -h "$tmp" -p 5432 -U "$db_user" -d postgres -v ON_ERROR_STOP=1 -f "$root/src/test/liveShownReappear.database.sql"