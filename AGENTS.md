<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Website Builder Daytona Agent Rules

These rules apply to all work in `website-builder-daytona`. Keep the Next.js
rule block above intact.

## Project Context

- This is a Next.js 16 App Router app with a host UI, API routes, Prisma,
  sandbox broker, WebSocket proxy, worker-agent, Docker-based sandbox runtime,
  and multiple agent runtimes.
- Prefer the existing architecture and local abstractions over new frameworks.
- Keep changes small, focused, and maintainable. Avoid large refactors unless
  explicitly requested.
- Do not install new dependencies unless they are necessary for the current
  task and the reason is documented.
- Preserve native spelling in user-facing text. Do not replace umlauts such as
  `ä`, `ö`, `ü`, or `ß`.

## Task Journal

- `TASKS.md` is the source of truth for active and completed work.
- `CHANGELOG.md` summarizes completed work by task.
- Before every non-trivial task, add or update a `TASKS.md` entry:
  - Use a stable ID in the format `T-YYYYMMDD-001`.
  - Set the status to `Planned` or `In Progress`.
  - Document the scope and intended approach briefly.
- After completing a task:
  - Set the task status to `Done`, or `Blocked` if it cannot be completed.
  - Add a concise `CHANGELOG.md` entry that references the task ID.
- Reference the task ID in commits and related documentation.
- Minimal one-command inspections do not need a new task entry. Any code,
  documentation, schema, config, or workflow change does.

## Commands

- Install dependencies with `pnpm install`.
- Start development:
  - `pnpm dev`
  - `pnpm dev:worker` when validating the local worker-agent flow.
- Build:
  - `pnpm build`
- Test:
  - `pnpm test`
  - `pnpm test:host`
  - Use `TEST_DATABASE_URL` pointing at an isolated test database for DB-backed
    host tests.
- Lint:
  - `pnpm lint`

## Next.js 16

- Before editing Next.js framework code, read the relevant local docs under
  `node_modules/next/dist/docs/`.
- App Router and Server Components are the default.
- Use Client Components only when state, effects, browser APIs, or event
  handlers are required.
- Route Handlers are for real HTTP boundaries. Do not route internal server
  data through API endpoints unnecessarily.
- `proxy.ts` replaces older middleware patterns in Next.js 16; keep proxy logic
  small and matchers narrow.

## TypeScript And React

- Use strict TypeScript and avoid `any`.
- Prefer explicit return types for exported functions and non-trivial helpers.
- Use functional React components.
- Keep components small and purpose-specific.
- Separate UI, runtime logic, data access, and protocol mapping.
- Prefer existing components under `components/ui`, `components/chat`, and
  `components/workspace` when they fit.

## Styling And UI

- Follow the styling approach already present in the repo. Do not introduce a
  new styling system without explicit approval.
- The current app uses global CSS/Tailwind-oriented setup and component-level
  class composition. Do not add Sass-only rules from unrelated projects.
- Keep operational UI dense, clear, and task-focused. Avoid decorative landing
  page patterns for dashboard and workspace surfaces.
- Use semantic HTML, accessible labels, visible focus states, and keyboard
  support for interactive controls.
- For public or preview-facing UI, check responsive behavior on mobile and
  desktop.

## Runtime, Broker, Worker, And Database

- Keep runtime-specific code behind the existing runtime/provider boundaries.
- Do not break existing `daytona-*`, `worker-pool-*`, `claude-code`,
  `openai-codex`, `vercel-ai`, or `openhands` paths while changing one path.
- Keep broker protocol changes synchronized with `packages/protocol`.
- Keep worker-agent HTTP contracts and HMAC behavior compatible with host
  routes.
- Prisma schema changes require migrations and focused tests.
- Never run DB tests against a non-test database. Use `TEST_DATABASE_URL`.
- Do not expose secrets in logs, client code, docs, tests, or commits.

## Documentation

- Keep `docs/superpowers/specs` and `docs/superpowers/plans` aligned when a
  phase status changes.
- Use `docs/AGENT_RUNTIME_OPTIONS.md` for runtime configuration changes.
- Prefer short, accurate docs updates over broad rewrites.
- If docs and code disagree, verify with Git and code, then update the docs.

## Git Workflow

- Use Conventional Commits:
  - `feat:`
  - `fix:`
  - `refactor:`
  - `test:`
  - `docs:`
  - `chore:`
  - `perf:`
- Include the task ID in commit messages when the work has a `TASKS.md` entry,
  for example: `docs: add task journal workflow for T-20260503-001`.
- Keep commits small and focused. Do not mix unrelated changes.
- Do not stage or revert unrelated user changes.
- Do not rewrite history or use destructive Git commands unless explicitly
  requested.
- Push only when requested or when the current task explicitly includes pushing.

## Verification

- Before claiming completion, run the smallest command set that proves the
  change:
  - Documentation-only changes: inspect rendered Markdown/diff; run no build
    unless the docs affect generated output.
  - Next.js or TypeScript changes: `pnpm lint` and usually `pnpm build`.
  - Runtime, broker, worker, protocol, or DB changes: focused tests plus the
    relevant package or host test command.
- If verification is blocked, record the blocker in `TASKS.md` and mention it
  in the final report.
