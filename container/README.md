# container/

Sandbox image (`container/sandbox/`) is the per-project Docker container
that runs the broker + claude-code + a Next.js dev server.

## Build locally

```bash
bash scripts/build-sandbox-image.sh        # → wbd/sandbox:dev
```

## Run a single sandbox manually (smoke test)

```bash
docker run --rm \
  -e PROJECT_ID=test \
  -e BROKER_TOKEN=$(openssl rand -hex 16) \
  -p 30001:4000 -p 30002:3000 \
  wbd/sandbox:dev
```

Then `curl http://localhost:30002` should hit the Next.js placeholder page
within ~10 s.

## In production (H.1c)

The image is pulled from `ghcr.io/appsolution-mw/sandbox:<sha>` and orchestrated
by the host's `WorkerPoolRuntime` via the `worker-agent` running on each Worker-VM.
