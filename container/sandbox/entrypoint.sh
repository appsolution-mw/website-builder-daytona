#!/bin/sh
# Daytona container entrypoint for website-builder-daytona.
#
# PREREQUISITE: This script assumes the monorepo is already checked out at
# the current working directory. The caller (host's cloud Daytona client)
# is responsible for: downloading the repo tarball via GitHub API (wget),
# extracting it to /workspace/repo, enabling corepack/pnpm, cd'ing into the
# repo, and then invoking this script.
#
# NOTE: Do NOT rely on `apk add` in the boot sequence. Alpine's package CDN
# is blocked inside Daytona Cloud sandboxes (TLS/403 errors). Use only tools
# already present in the node:24-alpine base image (wget, tar, corepack).
#
# Required env (injected by the host when calling daytona.create / executeCommand):
#   PROJECT_ID             — UUID of the project (exposed to the template)
#   BROKER_PORT            — defaults to 4000
#   PREVIEW_PORT           — defaults to 3000
#
# The script:
#   1. Installs monorepo deps (broker + ws-proxy + shared protocol)
#   2. Copies container/sandbox/project-template/ to /workspace/project
#   3. Installs project deps (no frozen lockfile — template ships without one)
#   4. Starts `next dev` in the background on PREVIEW_PORT
#   5. Execs broker in the foreground on BROKER_PORT

set -eu

: "${PROJECT_ID:?PROJECT_ID is required}"
BROKER_PORT="${BROKER_PORT:-4000}"
PREVIEW_PORT="${PREVIEW_PORT:-3000}"

echo "[entrypoint] starting for project ${PROJECT_ID}"
REPO_DIR="$(pwd)"

echo "[entrypoint] installing monorepo deps..."
pnpm install --frozen-lockfile --prod=false

echo "[entrypoint] staging project template..."
mkdir -p /workspace
cp -r "${REPO_DIR}/container/sandbox/project-template" /workspace/project
cd /workspace/project
echo "[entrypoint] installing project deps (no frozen lockfile — template has none)..."
pnpm install

echo "[entrypoint] installing claude code cli…"
npm install -g @anthropic-ai/claude-code >/workspace/claude-install.log 2>&1
if ! command -v claude >/dev/null 2>&1; then
  echo "[entrypoint] WARN: claude CLI not on PATH after install; agent features will fail" >&2
  tail -20 /workspace/claude-install.log >&2 || true
fi

echo "[entrypoint] copying .claude/ into project…"
if [ -d "${REPO_DIR}/container/sandbox/project-template/.claude" ]; then
  cp -r "${REPO_DIR}/container/sandbox/project-template/.claude" /workspace/project/.claude
fi

echo "[entrypoint] starting next dev on :${PREVIEW_PORT}..."
PORT="${PREVIEW_PORT}" PROJECT_ID="${PROJECT_ID}" \
  pnpm dev > /workspace/project.log 2>&1 &
NEXT_PID=$!

# Give next dev 2s to fail fast on obvious errors
sleep 2
if ! kill -0 "${NEXT_PID}" 2>/dev/null; then
  echo "[entrypoint] FATAL: next dev died during startup" >&2
  cat /workspace/project.log >&2
  exit 1
fi

echo "[entrypoint] starting broker on :${BROKER_PORT} (foreground)..."
cd "${REPO_DIR}"
BROKER_PORT="${BROKER_PORT}" exec pnpm -F @wbd/broker start
