#!/bin/sh
# Kill any stale dev processes bound to our ports so `pnpm dev` can start clean.
# Invoked automatically by `pnpm dev` (see root package.json).

set -eu

PORTS="3000 4000 4100"

for P in $PORTS; do
  PIDS=$(lsof -iTCP:"$P" -sTCP:LISTEN -P -n -t 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    # shellcheck disable=SC2086
    echo "[clean-ports] killing stale PID(s) $PIDS on :$P"
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
  fi
done

# Give the OS a moment to release the sockets
sleep 0.3
