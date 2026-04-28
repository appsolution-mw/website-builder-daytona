#!/usr/bin/env bash
set -eu

: "${WORKER_AGENT_HMAC_SECRET:?set in .env}"

# Use locally-built worker-agent image by default; can override with TAG env
TAG="${WORKER_AGENT_IMAGE:-wbd/worker-agent:dev}"
WORKER_ID="${WORKER_ID:-local-1}"

# Build the image if it's the dev tag and missing
if [ "$TAG" = "wbd/worker-agent:dev" ]; then
  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    echo "Building $TAG…"
    docker build -f worker-agent/Dockerfile -t "$TAG" .
  fi
fi

docker rm -f wbd-worker-agent >/dev/null 2>&1 || true
docker run -d --name wbd-worker-agent \
  --add-host=host.docker.internal:host-gateway \
  -p 4500:4500 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e HOST_URL=http://host.docker.internal:3000 \
  -e HMAC_SECRET="${WORKER_AGENT_HMAC_SECRET}" \
  -e SANDBOX_IMAGE="${SANDBOX_IMAGE:-wbd/sandbox:dev}" \
  -e WORKER_ID="${WORKER_ID}" \
  "$TAG"

echo "Waiting for worker-agent /health…"
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:4500/health > /dev/null; then break; fi
  sleep 1
done
curl -sf http://127.0.0.1:4500/health > /dev/null || { echo "worker-agent failed to start" >&2; docker logs wbd-worker-agent; exit 1; }

echo "Registering local worker in DB…"
WORKER_ID="${WORKER_ID}" pnpm tsx scripts/register-local-worker.ts

echo "Local worker-agent ready."
