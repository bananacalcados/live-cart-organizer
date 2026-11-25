#!/usr/bin/env bash
set -euo pipefail
# Discardable local DB, private socket only, no TCP and no production connection.
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp=$(mktemp -d /tmp/persistent-last4.XXXXXX)
runner=(); db_user=$(id -un)
if [ "$(id -u)" = 0 ]; then
  if id nobody >/dev/null 2>&1; then db_user=nobody; else db_user=lovable; fi
  chown "$(id -u "$db_user"):$(id -g "$db_user")" "$tmp"
  runner=(setpriv --reuid="$(id -u "$db_user")" --regid="$(id -g "$db_user")" --clear-groups)
fi
pg_bin=$(dirname "$(readlink -f "$(command -v initdb)")")
trap '"${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
"${runner[@]}" "$pg_bin/initdb" -D "$tmp/data" -A trust --no-locale > "$tmp/init.log"
"${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -l "$tmp/server.log" -o "-k $tmp -p 5432 -c listen_addresses=''" -w start >/dev/null
psql -X -h "$tmp" -p 5432 -U "$db_user" -d postgres -v ON_ERROR_STOP=1 -f "$root/src/test/livePhoneLast4.database.sql"
