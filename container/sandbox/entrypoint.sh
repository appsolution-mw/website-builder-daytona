#!/bin/sh
# Sandbox entrypoint for the pre-built wbd/sandbox image.
#
# All deps are pre-installed in the image. This script only:
#   1) seeds /workspace/project from /opt/project-template if empty
#   2) starts `next dev` in the background on PREVIEW_PORT
#   3) execs broker in the foreground on BROKER_PORT
#
# Required env (injected by the host via worker-agent):
#   PROJECT_ID    — project uuid
#   BROKER_TOKEN  — random token forwarded to broker for ws auth
# Optional:
#   BROKER_PORT   — defaults 4000
#   PREVIEW_PORT  — defaults 3000

set -eu

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${BROKER_TOKEN:?BROKER_TOKEN is required}"
BROKER_PORT="${BROKER_PORT:-4000}"
PREVIEW_PORT="${PREVIEW_PORT:-3000}"

echo "[entrypoint] sandbox starting for project ${PROJECT_ID}"

mkdir -p /workspace
if [ ! -d /workspace/project ] || [ -z "$(ls -A /workspace/project 2>/dev/null)" ]; then
  echo "[entrypoint] seeding /workspace/project from /opt/project-template"
  mkdir -p /workspace/project
  cp -a /opt/project-template/. /workspace/project/
fi

cd /workspace/project
echo "[entrypoint] starting next dev on :${PREVIEW_PORT}"
PORT="${PREVIEW_PORT}" PROJECT_ID="${PROJECT_ID}" \
  pnpm dev > /workspace/project.log 2>&1 &
NEXT_PID=$!

sleep 2
if ! kill -0 "${NEXT_PID}" 2>/dev/null; then
  echo "[entrypoint] FATAL: next dev died" >&2
  cat /workspace/project.log >&2
  exit 1
fi

echo "[entrypoint] starting broker on :${BROKER_PORT} (foreground)"
cd /opt/builder
BROKER_PORT="${BROKER_PORT}" BROKER_TOKEN="${BROKER_TOKEN}" exec pnpm -F @wbd/broker start
