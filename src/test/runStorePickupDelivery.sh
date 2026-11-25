#!/usr/bin/env bash
set -euo pipefail
# Disposable socket-only database. Never uses the production PG environment.
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d /tmp/store-pickup-regression.XXXXXX)"
pg_bin="$(dirname "$(readlink -f "$(command -v initdb)")")"
runner=()
db_user="$(id -un)"
if [ "$(id -u)" = 0 ]; then
  db_user=lovable
  uid="$(id -u "$db_user")"
  gid="$(id -g "$db_user")"
  chown "$uid:$gid" "$tmp"
  runner=(setpriv --reuid="$uid" --regid="$gid" --clear-groups)
fi
cleanup() {
  "${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
"${runner[@]}" "$pg_bin/initdb" -D "$tmp/data" -A trust --no-locale >"$tmp/init.log"
"${runner[@]}" "$pg_bin/pg_ctl" -D "$tmp/data" -l "$tmp/server.log" -o "-k $tmp -p 5432 -c listen_addresses=''" -w start >/dev/null
psql -X -h "$tmp" -p 5432 -U "$db_user" -d postgres -v ON_ERROR_STOP=1 -f "$root/src/test/storePickupDelivery.database.sql"