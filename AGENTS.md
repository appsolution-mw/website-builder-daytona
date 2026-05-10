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

## Task And Changelog Files

Never read full historical task or changelog files during normal implementation
work. Use the current task file and the current monthly changelog only.

- `TASKS.md` and `CHANGELOG.md` MUST only be short index or entry-point files.
  They MUST NOT contain long work logs, full implementation histories, or
  detailed task records.
- Agents MUST keep task and changelog context small. During normal work, agents
  MUST read only the smallest relevant file set:
  1. `AGENTS.md`
  2. `docs/tasks/CURRENT_TASK.md`, if it exists
  3. the current task file
  4. directly relevant source, config, schema, workflow, or documentation files
- Agents MUST NOT automatically scan or fully read all files under
  `docs/tasks/`, `docs/tasks/done/`, or `docs/changelog/`.
- Historical task or changelog files MAY be read only when the user explicitly
  asks for historical analysis, audit, migration, or traceability work.

Task files MUST be stored as small, focused Markdown files:

```text
docs/tasks/
  CURRENT_TASK.md
  INDEX.md
  active/
    T-YYYYMMDD-001.md
  done/
    YYYY/
      MM/
        T-YYYYMMDD-001.md
```

Changelogs MUST be stored by month:

```text
docs/changelog/
  INDEX.md
  YYYY-MM.md
```

Before every non-trivial task, agents MUST create or update exactly one task
file under `docs/tasks/active/`.

- Task IDs MUST be stable and use the format `T-YYYYMMDD-001`.
- A task file is REQUIRED for changes to code, documentation, schema, config,
  build tooling, deployment workflows, or AI workflow rules.
- Small read-only inspections and simple one-command checks do not need a task
  file.
- `docs/tasks/CURRENT_TASK.md` SHOULD point to the active task only when there
  is one current task. It MUST stay short.

Each task file SHOULD use this structure:

```markdown
# T-YYYYMMDD-001 - Short task title

Status: In Progress
Date: YYYY-MM-DD
Owner: AI Agent

Related files:
- path/to/file

## Scope

Short description of the task.

## Plan

- Step 1
- Step 2

## Notes

Important implementation notes only.

## Outcome

Pending / completed result.
```

When completing a task, agents MUST:

- Set the current task file status to `Done`, or `Blocked` if it cannot be
  completed.
- Fill in the task file `Outcome` section.
- Move the task file from `docs/tasks/active/` to
  `docs/tasks/done/YYYY/MM/`.
- Add exactly one short entry to the matching monthly changelog file
  `docs/changelog/YYYY-MM.md`.
- Update `docs/tasks/CURRENT_TASK.md` only if another task remains active;
  otherwise leave it absent or point it to no active task.

Changelog entries MUST be append-only and concise.

- Do not maintain a giant global `CHANGELOG.md`.
- Use one monthly file per month.
- Each entry MUST include the date, task ID, and a short summary.
- Each entry MAY include affected files.
- Changelogs MUST NOT contain detailed implementation logs. Details belong in
  the task file, Git commits, PRs, specs, plans, or relevant documentation.

Legacy monolithic files MUST be treated as archives.

- If large `TASKS.md` or `CHANGELOG.md` files already exist, agents MUST NOT
  automatically migrate or fully read them.
- Existing large files SHOULD be moved only by explicit request, for example to
  `docs/archive/TASKS.legacy.md` and `docs/archive/CHANGELOG.legacy.md`.
- New work MUST use the split task and monthly changelog structure.
- Historical content MUST be backfilled only when the user explicitly asks for
  backfill, migration, audit, or historical traceability.
- Reference the task ID in commits and related documentation.

## Sub-Agent Delegation

- Split work across sub-agents whenever the task has independent parts that can
  be handled in parallel or by focused roles. Good candidates include separate
  code areas, independent investigations, implementation plus verification, or
  plan/spec review plus execution.
- Keep work local when the change is small, tightly coupled, urgent on the
  critical path, or when delegation would add coordination overhead without
  improving speed or quality.
- Decide and state the delegation strategy before implementation for
  non-trivial work: which parts stay local, which parts go to sub-agents, and
  why.
- Give each sub-agent a bounded ownership area, expected output, verification
  command, and relevant files or docs. Sub-agents are not alone in the codebase;
  they must not revert unrelated edits and must coordinate with existing
  changes.
- Choose reasoning effort per sub-agent based on task complexity:
  - Use `medium` for bounded implementation, focused codebase questions,
    mechanical documentation updates, and low-risk verification.
  - Use `high` for architecture, broad codebase analysis, runtime/broker/DB
    changes, security-sensitive work, ambiguous requirements, debugging with
    unclear root cause, or review tasks that require judgment across multiple
    files.
- If a sub-agent reports uncertainty, missing context, or a blocker, either
  provide more context, increase reasoning effort, split the task smaller, or
  handle the blocker locally. Do not retry the same unclear prompt unchanged.

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
- Do not break existing `worker-pool-*`, `claude-code`, `openai-codex`, or
  `openhands` paths while changing one path.
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
- Include the task ID in commit messages when the work has a task file, for
  example: `docs: update task workflow rules for T-20260504-001`.
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
- If verification is blocked, record the blocker in the current task file and
  mention it in the final report.
