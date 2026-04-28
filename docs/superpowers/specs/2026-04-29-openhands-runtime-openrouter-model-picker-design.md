# OpenHands Runtime + OpenRouter Model Picker Design Spec

**Date:** 2026-04-29
**Status:** Design, awaiting user review
**Project root:** `/Volumes/Extern/Projekte/website-builder-daytona`
**Chosen approach:** Option A - add OpenHands as a runtime and expose searchable OpenRouter model selection only where the selected runtime can safely consume OpenRouter model IDs.

---

## 1. Goal

Add OpenHands SDK as an additional coding-agent runtime in the existing sandbox broker, and let users choose an OpenRouter LLM from a searchable dropdown for OpenHands and the existing `vercel-ai` runtime.

The integration must preserve the current workspace UX: chat on the left, live preview/code on the right, streaming `agent.*` events, session history, token usage display, file locking during agent turns, and reviewer behavior after file-writing turns.

---

## 2. Key Documentation Findings

OpenHands SDK is a Python SDK. The docs show `pip install openhands-sdk` and `pip install openhands-tools`; a basic local agent is built with `LLM`, `Agent`, `Conversation`, and tools such as `TerminalTool`, `FileEditorTool`, and `TaskTrackerTool`.

OpenHands uses LiteLLM-style model identifiers and accepts `api_key` plus optional `base_url`, so OpenRouter can be used through:

```env
LLM_MODEL=<openrouter-model-id>
LLM_API_KEY=<OPENROUTER_API_KEY>
LLM_BASE_URL=https://openrouter.ai/api/v1
```

OpenHands sub-agents are supported through `DelegateTool`. The orchestrating agent registers the tool, adds it to `tools`, and can spawn/delegate work to sub-agents. File-based agents can be auto-registered with `register_file_agents("/path/to/project")`; definitions live as Markdown files and can declare tools and an optional model.

OpenHands skills are loaded into `AgentContext`. Project context such as `AGENTS.md` can be loaded with `load_project_skills(workspace_dir=...)`; AgentSkills-style `SKILL.md` directories can be loaded with `load_skills_from_dir(...)`; public skills can be enabled by `AgentContext(load_public_skills=True)`.

OpenRouter exposes a public models endpoint at `https://openrouter.ai/api/v1/models`. The docs define query parameters including `output_modalities=text` and `supported_parameters=tools`, and model fields such as `id`, `name`, `context_length`, `pricing`, `top_provider`, and `supported_parameters`.

Sources:

- OpenHands SDK: https://docs.openhands.dev/sdk
- OpenHands Hello World: https://docs.openhands.dev/sdk/guides/hello-world
- OpenHands skills: https://docs.openhands.dev/sdk/guides/skill
- OpenHands delegation: https://docs.openhands.dev/sdk/guides/agent-delegation
- OpenHands file-based agents: https://docs.openhands.dev/sdk/guides/agent-file-based
- OpenRouter models API: https://openrouter.ai/docs/guides/overview/models

---

## 3. Chosen Options Summary

| Decision | Choice |
|---|---|
| OpenHands integration form | Local Python bridge process spawned by the TypeScript broker |
| Runtime name | `openhands` |
| Model source | OpenRouter `/api/v1/models?output_modalities=text&supported_parameters=tools` |
| Model picker scope | Shown for `openhands` and `vercel-ai`; hidden for `claude-code` and `openai-codex` |
| Model ID storage | Existing `SessionRuntimeState.modelId` |
| OpenHands session persistence | In-memory conversation map by `providerSessionId` for MVP |
| Skills | Load project `AGENTS.md` and local OpenHands skills from a project skills directory when present |
| Sub-agents | Enable `DelegateTool` and auto-register project/user file-based agents |
| Reviewer | Implement an OpenHands reviewer pass if the bridge supports it cleanly; otherwise keep `runReview` optional and rely on existing broker behavior |
| Dependencies | Add Python/OpenHands packages to sandbox image only; no frontend UI dependency |

---

## 4. Architecture

The current project already has a clean runtime boundary:

- `packages/protocol/src/index.ts` defines `AgentRuntime`, `agent.prompt`, `agent.session`, and optional `modelId`.
- `container/sandbox/broker/src/agent-provider.ts` defines `AgentProvider`.
- `container/sandbox/broker/src/agent-provider-factory.ts` selects a provider implementation.
- `container/sandbox/broker/src/ws-server.ts` is provider-agnostic and already passes `modelId` into `runTurn`.
- `SessionRuntimeState.modelId` already exists in Prisma and is persisted through the session PATCH route.

OpenHands should fit behind the existing provider interface:

```
Browser
  `- agent.prompt { runtime: "openhands", modelId: "openrouter:qwen/qwen3-coder:free" }
       |
ws-proxy
       |
sandbox broker TypeScript
  `- openhands-runner.ts
       `- spawn python openhands_bridge.py --session <providerSessionId> --model <model>
             | JSONL
       <- { type: "chunk" | "tool" | "status" | "done" | "error", ... }
       |
BrokerToHost agent.* events
       |
UI chat bubbles + file/preview refresh
```

The bridge process is intentionally thin. It owns OpenHands-specific setup and emits simple JSONL events that TypeScript can test without importing Python modules:

- Configure `LLM(model, api_key, base_url)`.
- Create an `Agent` with terminal, file editor, task tracker, and delegate tools.
- Load project context/skills from `/workspace/project`.
- Register built-in and file-based sub-agents.
- Create or reuse a `Conversation` for the provided session ID.
- Run the prompt in `/workspace/project`.
- Stream event summaries to stdout as JSONL.
- Emit final metrics when available.

---

## 5. Runtime Identity and Configuration

Add `openhands` across runtime identity surfaces:

- `packages/protocol/src/index.ts`: `AgentRuntime = "claude-code" | "openai-codex" | "vercel-ai" | "openhands"`.
- `prisma/schema.prisma`: add `OPENHANDS` to `AgentRuntime`.
- `lib/agents/runtime.ts`: add label `OpenHands`, provider `OpenHands SDK`, DB/protocol mapping, default model.
- `container/sandbox/broker/src/agent-provider.ts`: parse `openhands`, `open-hands`, and `openhands-sdk`.
- `container/sandbox/broker/src/agent-provider-factory.ts`: branch to `runOpenHandsTurn` and optional `runOpenHandsReviewPass`.

Environment variables:

```env
AGENT_RUNTIME=openhands
OPENROUTER_API_KEY=
OPENHANDS_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_REVIEWER_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_BASE_URL=https://openrouter.ai/api/v1
OPENHANDS_MAX_ITERATIONS=30
OPENHANDS_ENABLE_PUBLIC_SKILLS=0
```

The broker runner normalizes `openrouter:<id>` for the UI and strips the prefix for OpenHands/LiteLLM only if the bridge requires bare provider IDs. Internally, selected model IDs remain stored as UI-facing IDs such as `openrouter:qwen/qwen3-coder:free`.

---

## 6. OpenHands Skills and Sub-agents

The bridge should apply project context in this order:

1. `load_project_skills("/workspace/project")` so `AGENTS.md`, `CLAUDE.md`, and similar project rules are included.
2. `load_skills_from_dir("/workspace/project/.openhands/skills")` if the directory exists.
3. `load_installed_skills()` for enabled user/global skills, if available in the runtime image.
4. `load_public_skills=True` only when `OPENHANDS_ENABLE_PUBLIC_SKILLS=1`.

Sub-agent setup:

- Register `DelegateTool`.
- Add `Tool(name=DelegateTool.name)` to the main agent.
- Call `register_builtins_agents()` for built-in agents if available.
- Call `register_file_agents("/workspace/project")` so project-defined Markdown agents can be delegated to.

Project agent files should be optional. If no `.agents/agents/*.md` or `.openhands/agents/*.md` files exist, OpenHands still works as a single agent with delegation tooling available.

---

## 7. OpenRouter Model Picker

Add a host API route:

`app/api/projects/[id]/models/route.ts`

Responsibilities:

- Verify project ownership using the same `DEV_USER_ID` pattern as existing project routes.
- Fetch `https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools`.
- Use `cache: "no-store"` or a small in-memory TTL cache; avoid persisting the public model catalog.
- Return only safe UI fields:

```ts
type OpenRouterModelOption = {
  id: string;
  label: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
};
```

The returned `id` is prefixed as `openrouter:${model.id}`. This matches the existing `vercel-ai` runner convention and keeps the UI explicit about provider routing.

UI behavior in `app/project/[id]/page.tsx`:

- Show the picker only when `selectedRuntime` is `openhands` or `vercel-ai`.
- Search by model name and ID.
- Default to the session runtime state's `modelId`, then runtime default if no session model exists.
- On model select, PATCH the existing session endpoint with:

```json
{
  "runtimeState": {
    "runtime": "openhands",
    "providerSessionId": "<existing-or-new-session-uuid>",
    "modelId": "openrouter:qwen/qwen3-coder:free"
  }
}
```

No new component dependency is needed. A small `components/chat/ModelPicker.tsx` can be built from the existing `Button`, `Input`, and `Badge` components.

---

## 8. Event Mapping

The Python bridge emits narrow JSONL records:

```ts
type OpenHandsBridgeEvent =
  | { type: "status"; phase: "starting" | "thinking" | "tool_use" | "writing_file"; detail?: string; agentId?: string }
  | { type: "chunk"; delta: string; agentId?: string }
  | { type: "tool"; tool: string; input: unknown; agentId?: string }
  | { type: "done"; durationMs: number; tokensIn: number; tokensOut: number; costUsd: number; usage?: unknown }
  | { type: "error"; message: string; agentId?: string };
```

`openhands-runner.ts` maps these into existing `BrokerToHost` events. It should never expose raw Python tracebacks as-is; errors are summarized and the raw tail is included only when useful for debugging.

Write detection should continue to rely primarily on `fs-tracker`. The bridge should also emit `tool: "Write"` or `phase: "writing_file"` for file edits so existing broker counters work even if a file write happens before chokidar observes it.

---

## 9. Testing

Use TDD for implementation.

Host/runtime tests:

- `lib/agents/__tests__/runtime.test.ts`: maps `openhands` between protocol and Prisma, validates labels and default model.
- Prisma migration test through existing build/typecheck path.

Broker tests:

- `container/sandbox/broker/tests/agent-provider.test.ts`: env parsing accepts `openhands`, `open-hands`, `openhands-sdk`.
- `container/sandbox/broker/tests/agent-provider-factory.test.ts`: factory returns OpenHands provider.
- `container/sandbox/broker/tests/openhands-runner.test.ts`: missing API key, model normalization, JSONL mapping, abort handling, done metrics.
- Bridge parser tests stay TypeScript-only; Python integration is covered by a smoke command where available.

UI/API tests:

- `lib` or route-level Vitest test for OpenRouter model response normalization using mocked `fetch`.
- `ModelPicker` test for search/filter/select behavior if the project already supports React component tests; otherwise keep logic in pure helpers and test those.

Verification commands:

```bash
pnpm -F @wbd/protocol typecheck
pnpm -F @wbd/broker test
pnpm test:host
pnpm build
```

---

## 10. Non-goals

- Do not expose arbitrary OpenRouter IDs to `claude-code` or `openai-codex` in this phase.
- Do not add a new frontend select/combobox dependency.
- Do not implement durable OpenHands conversation persistence in Prisma yet; keep the MVP in-memory like the current Codex thread cache.
- Do not enable public skills by default, because first-run cloning/network behavior should be explicit.
- Do not replace existing Claude/Codex/Vercel runtimes.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| OpenHands Python packages increase sandbox image size and build time | Install only `openhands-sdk` and `openhands-tools` for MVP; defer remote agent-server packages |
| OpenHands event objects change between SDK versions | Keep Python bridge output stable and test TypeScript against bridge JSONL contract |
| OpenRouter models may not handle agentic tool use equally well | Filter `supported_parameters=tools` and show model IDs clearly |
| Sub-agent behavior may be too opaque in UI | Preserve `agentId` in bridge records when available and fall back to `OpenHands`/`Orchestrator` labels |
| Existing dirty worktree may conflict with implementation | Touch only task-scoped files and stage/commit logical slices |

---

## 12. Rollout

1. Add runtime identity and Prisma migration.
2. Add OpenRouter model API and searchable picker.
3. Add OpenHands bridge and broker runner behind `AGENT_RUNTIME=openhands`.
4. Add sandbox image Python dependencies and env pass-through.
5. Verify locally with `openhands` and one OpenRouter tool-capable model.
6. Document setup in `.env.example` and `docs/AGENT_RUNTIME_OPTIONS.md`.

The feature is considered complete when a user can select `OpenHands`, search/select an OpenRouter model, send a prompt, see streamed agent output, and observe file edits in the existing workspace UI.
