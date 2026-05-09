# ===== Stage 1: workspace deps for broker + agent-runner =====
FROM node:24-trixie-slim AS deps
WORKDIR /opt/builder
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/protocol/ packages/protocol/
COPY container/sandbox/broker/package.json container/sandbox/broker/
COPY container/sandbox/agent-runner/package.json container/sandbox/agent-runner/
RUN pnpm install --filter @wbd/broker --filter @wbd/agent-runner --frozen-lockfile

# ===== Stage 2: project-template deps =====
FROM node:24-trixie-slim AS template-deps
WORKDIR /opt/project-template
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY container/sandbox/project-template/package.json ./
RUN pnpm install --no-frozen-lockfile
COPY container/sandbox/project-template/ ./

# ===== Stage 3: runtime image =====
FROM node:24-trixie-slim
WORKDIR /opt/builder
# Note: the @anthropic-ai/claude-code CLI binary is no longer installed.
# The agent-runner sibling service (Fastify + @anthropic-ai/claude-agent-sdk)
# replaces the CLI subprocess and is launched alongside the broker by the
# entrypoint script.
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip tmux \
 && python3 -m pip install --break-system-packages --no-cache-dir "openhands-sdk>=1.19,<1.20" "openhands-tools>=1.19,<1.20" \
 && rm -rf /var/lib/apt/lists/*

# Bring in workspace deps and broker + agent-runner sources
COPY --from=deps /opt/builder /opt/builder
COPY container/sandbox/broker/ /opt/builder/container/sandbox/broker/
COPY container/sandbox/agent-runner/ /opt/builder/container/sandbox/agent-runner/

# Default agent-context (CLAUDE.md, skills/, agents/) merged into the workspace
# at sandbox start by the agent-runner bootstrap endpoint. Per-project overrides
# are applied on top by the host adapter.
COPY agent-context/ /opt/agent-context/

# Bring in pre-installed project template
COPY --from=template-deps /opt/project-template /opt/project-template

COPY container/sandbox/entrypoint.sh /usr/local/bin/sandbox-entrypoint
RUN chmod +x /usr/local/bin/sandbox-entrypoint

EXPOSE 3000 4000
ENTRYPOINT ["sandbox-entrypoint"]
