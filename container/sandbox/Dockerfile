# ===== Stage 1: workspace deps for broker =====
FROM node:24-bookworm-slim AS deps
WORKDIR /opt/builder
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/protocol/ packages/protocol/
COPY container/sandbox/broker/package.json container/sandbox/broker/
RUN pnpm install --filter @wbd/broker --frozen-lockfile

# ===== Stage 2: project-template deps =====
FROM node:24-bookworm-slim AS template-deps
WORKDIR /opt/project-template
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY container/sandbox/project-template/package.json ./
RUN pnpm install --no-frozen-lockfile
COPY container/sandbox/project-template/ ./

# ===== Stage 3: runtime image =====
FROM node:24-bookworm-slim
WORKDIR /opt/builder
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Bring in workspace deps and broker source
COPY --from=deps /opt/builder /opt/builder
COPY container/sandbox/broker/ /opt/builder/container/sandbox/broker/

# Bring in pre-installed project template
COPY --from=template-deps /opt/project-template /opt/project-template

COPY container/sandbox/entrypoint.sh /usr/local/bin/sandbox-entrypoint
RUN chmod +x /usr/local/bin/sandbox-entrypoint

EXPOSE 3000 4000
ENTRYPOINT ["sandbox-entrypoint"]
