FROM node:24-bookworm-slim AS deps
WORKDIR /opt/worker-agent
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY worker-agent/package.json worker-agent/
RUN pnpm install --filter @wbd/worker-agent --frozen-lockfile

FROM node:24-bookworm-slim
WORKDIR /opt/worker-agent
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /opt/worker-agent /opt/worker-agent
COPY worker-agent/ /opt/worker-agent/worker-agent/
WORKDIR /opt/worker-agent/worker-agent
EXPOSE 4500
ENV PORT=4500
CMD ["pnpm", "start"]
