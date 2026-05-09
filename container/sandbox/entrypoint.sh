#!/bin/sh
# Sandbox entrypoint for the pre-built wbd/sandbox image.
#
# Template deps are pre-installed in the image. This script:
#   1) seeds /workspace/project or clones the selected GitHub repo
#   2) installs project deps when a repo was cloned
#   3) starts the app dev server in the background on PREVIEW_PORT
#   4) starts the agent-runner sibling in the background on AGENT_RUNNER_PORT
#   5) execs broker in the foreground on BROKER_PORT
#
# Required env (injected by the host via worker-agent):
#   PROJECT_ID                — project uuid
#   BROKER_TOKEN              — random token forwarded to broker for ws auth
#   AGENT_RUNNER_HMAC_SECRET  — shared secret broker<->agent-runner HTTP HMAC
# Optional:
#   BROKER_PORT        — defaults 4000
#   PREVIEW_PORT       — defaults 3000
#   AGENT_RUNNER_PORT  — defaults 7050 (loopback only)
#   PROJECT_SOURCE_TYPE — template|github; defaults template

set -eu

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${BROKER_TOKEN:?BROKER_TOKEN is required}"
: "${AGENT_RUNNER_HMAC_SECRET:?AGENT_RUNNER_HMAC_SECRET is required}"
BROKER_PORT="${BROKER_PORT:-4000}"
PREVIEW_PORT="${PREVIEW_PORT:-3000}"
AGENT_RUNNER_PORT="${AGENT_RUNNER_PORT:-7050}"
PROJECT_SOURCE_TYPE="${PROJECT_SOURCE_TYPE:-template}"
GITHUB_REPO_OWNER="${GITHUB_REPO_OWNER:-}"
GITHUB_REPO_NAME="${GITHUB_REPO_NAME:-}"
GITHUB_REPO_BRANCH="${GITHUB_REPO_BRANCH:-}"
GITHUB_REPO_TOKEN="${GITHUB_REPO_TOKEN:-}"
GITHUB_REPO_COMMIT_SHA="${GITHUB_REPO_COMMIT_SHA:-}"

sanitize_url() {
  echo "$1" | sed -E 's#https://[^@]+@github.com/#https://github.com/#g'
}

clone_github_repo() {
  if [ -z "$GITHUB_REPO_OWNER" ] || [ -z "$GITHUB_REPO_NAME" ] || [ -z "$GITHUB_REPO_BRANCH" ] || [ -z "$GITHUB_REPO_TOKEN" ]; then
    echo "[entrypoint] FATAL: missing GitHub source env" >&2
    exit 1
  fi

  mkdir -p /workspace
  rm -rf /workspace/project
  CLONE_URL="https://x-access-token:${GITHUB_REPO_TOKEN}@github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}.git"
  echo "[entrypoint] cloning $(sanitize_url "$CLONE_URL") branch ${GITHUB_REPO_BRANCH}"
  git clone --depth 1 --branch "$GITHUB_REPO_BRANCH" "$CLONE_URL" /workspace/project 2>/workspace/git-clone.err || {
    echo "[entrypoint] FATAL: git clone failed for ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}" >&2
    sed -E 's#https://[^@]+@github.com/#https://github.com/#g' /workspace/git-clone.err >&2
    exit 1
  }

  cd /workspace/project
  if [ -n "$GITHUB_REPO_COMMIT_SHA" ]; then
    git fetch --depth 1 origin "$GITHUB_REPO_COMMIT_SHA" || true
    git checkout "$GITHUB_REPO_COMMIT_SHA"
  fi
  git remote set-url origin "https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}.git"
}

install_project_deps() {
  if [ -f pnpm-lock.yaml ]; then
    corepack enable pnpm
    pnpm install --frozen-lockfile || pnpm install
    DEV_CMD="pnpm dev"
  elif [ -f package-lock.json ]; then
    npm ci || npm install
    DEV_CMD="npm run dev"
  elif [ -f yarn.lock ]; then
    corepack enable yarn
    yarn install
    DEV_CMD="yarn dev"
  else
    corepack enable pnpm
    pnpm install
    DEV_CMD="pnpm dev"
  fi
}

echo "[entrypoint] sandbox starting for project ${PROJECT_ID}"

mkdir -p /workspace
if [ "$PROJECT_SOURCE_TYPE" = "github" ]; then
  if [ ! -d /workspace/project/.git ]; then
    clone_github_repo
  fi
else
  if [ ! -d /workspace/project ] || [ -z "$(ls -A /workspace/project 2>/dev/null)" ]; then
    echo "[entrypoint] seeding /workspace/project from /opt/project-template"
    mkdir -p /workspace/project
    cp -a /opt/project-template/. /workspace/project/
  fi
fi

cd /workspace/project

if [ "$PROJECT_SOURCE_TYPE" != "github" ] && [ ! -d .git ]; then
  echo "[entrypoint] initialising git repo in /workspace/project"
  git init -q -b main
fi

git config user.email "sandbox@wbd.local"
git config user.name "Website Builder Daytona"

if [ "$PROJECT_SOURCE_TYPE" != "github" ]; then
  git add -A
  git commit -q -m "initial template" || true
fi

if [ -n "${PROJECT_ENV_B64:-}" ]; then
  echo "[entrypoint] writing project .env"
  printf '%s' "${PROJECT_ENV_B64}" | base64 -d > /workspace/project/.env
fi

if [ -n "${OPENHANDS_FILES_B64:-}" ]; then
  echo "[entrypoint] writing managed OpenHands config files"
  OPENHANDS_TMP="/tmp/openhands-files.json"
  printf '%s' "${OPENHANDS_FILES_B64}" | base64 -d > "${OPENHANDS_TMP}"
  python3 - <<'PY'
import json
from pathlib import Path

root = Path("/workspace/project").resolve()
items = json.loads(Path("/tmp/openhands-files.json").read_text(encoding="utf-8"))
for item in items:
    rel = item["path"]
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        raise SystemExit(f"refusing path outside workspace: {rel}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(item["content"], encoding="utf-8")
PY
fi

install_project_deps

echo "[entrypoint] starting next dev on :${PREVIEW_PORT}"
PORT="${PREVIEW_PORT}" PROJECT_ID="${PROJECT_ID}" \
  sh -c "$DEV_CMD" > /workspace/project.log 2>&1 &
NEXT_PID=$!

sleep 2
if ! kill -0 "${NEXT_PID}" 2>/dev/null; then
  echo "[entrypoint] FATAL: next dev died" >&2
  cat /workspace/project.log >&2
  exit 1
fi

cd /opt/builder

echo "[entrypoint] starting agent-runner on 127.0.0.1:${AGENT_RUNNER_PORT} (background)"
AGENT_RUNNER_PORT="${AGENT_RUNNER_PORT}" \
AGENT_RUNNER_HMAC_SECRET="${AGENT_RUNNER_HMAC_SECRET}" \
  pnpm -F @wbd/agent-runner start > /workspace/agent-runner.log 2>&1 &
RUNNER_PID=$!

# Propagate signals to the agent-runner so the container shuts down cleanly.
trap 'kill -TERM "${RUNNER_PID}" 2>/dev/null || true' TERM INT EXIT

# Brief liveness check: agent-runner is required for any claude-code turn,
# so fail fast if it died during startup.
sleep 1
if ! kill -0 "${RUNNER_PID}" 2>/dev/null; then
  echo "[entrypoint] FATAL: agent-runner died during startup" >&2
  cat /workspace/agent-runner.log >&2 || true
  exit 1
fi

echo "[entrypoint] starting broker on :${BROKER_PORT} (foreground)"
BROKER_PORT="${BROKER_PORT}" \
BROKER_TOKEN="${BROKER_TOKEN}" \
AGENT_RUNNER_HMAC_SECRET="${AGENT_RUNNER_HMAC_SECRET}" \
AGENT_RUNNER_PORT="${AGENT_RUNNER_PORT}" \
  exec pnpm -F @wbd/broker start
