# Workspace Terminal And Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Workspace Terminal tab for sandbox commands and a Console tab for Preview browser output.

**Architecture:** Extend `@wbd/protocol` with terminal command messages. Implement broker-side command spawning in the sandbox project root and render terminal output in the existing client workspace. Capture Preview console events in the browser using a same-origin iframe bridge and `postMessage`.

**Tech Stack:** Next.js 16 App Router Client Component, React 19, TypeScript, WebSocket protocol, Node child_process, Vitest.

---

### Task 1: Broker Terminal Protocol

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `container/sandbox/broker/src/ws-server.ts`
- Create: `container/sandbox/broker/src/terminal-runner.ts`
- Test: `container/sandbox/broker/tests/ws-server.test.ts`

- [ ] Add failing WebSocket tests for `terminal.run` output and locked rejection.
- [ ] Add protocol message types for `terminal.run`, `terminal.abort`, `terminal.output`, and `terminal.exit`.
- [ ] Implement a small command runner that spawns shell commands in `projectRoot`.
- [ ] Wire the runner into `ws-server.ts`, with one active terminal command per broker connection.
- [ ] Run `pnpm -F @wbd/broker test -- ws-server.test.ts`.

### Task 2: Workspace Terminal UI

**Files:**
- Modify: `components/workspace/RightPane.tsx`
- Modify: `app/project/[id]/page.tsx`

- [ ] Extend right pane tabs with `Terminal` and `Console`.
- [ ] Add terminal state, command form, output append/clear logic, and abort control.
- [ ] Send `terminal.run` over the existing WebSocket and render terminal protocol events.
- [ ] Keep output bounded and preserve line breaks in a monospace scroll area.
- [ ] Run `pnpm lint`.

### Task 3: Preview Console UI

**Files:**
- Modify: `app/project/[id]/page.tsx`

- [ ] Replace direct iframe `src` usage with a bridge `srcDoc` for preview console capture.
- [ ] Listen for `message` events from the bridge and append console entries.
- [ ] Render the Console tab with severity labels, timestamps, and clear control.
- [ ] Run `pnpm lint`.

### Task 4: Documentation And Verification

**Files:**
- Modify: `TASKS.md`
- Modify: `CHANGELOG.md`

- [ ] Mark `T-20260504-013` done.
- [ ] Add a concise changelog entry.
- [ ] Run focused broker tests and lint.
