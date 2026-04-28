# OpenHands Runtime + OpenRouter Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `openhands` as a sandbox agent runtime and add searchable OpenRouter model selection for `openhands` and `vercel-ai`.

**Architecture:** The existing TypeScript broker remains the orchestrator. OpenHands runs behind the existing `AgentProvider` interface through a thin Python bridge process that emits stable JSONL events. OpenRouter model selection is fetched by a host route, stored in the existing `SessionRuntimeState.modelId`, and sent through the existing `agent.prompt.modelId` path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Prisma/Postgres, Vitest, TypeScript broker, Python OpenHands SDK (`openhands-sdk`, `openhands-tools`), OpenRouter Models API.

**Spec reference:** `docs/superpowers/specs/2026-04-29-openhands-runtime-openrouter-model-picker-design.md`

---

## Repo Layout After This Plan

```text
website-builder-daytona/
|-- packages/protocol/src/index.ts
|-- prisma/schema.prisma
|-- prisma/migrations/20260429090000_add_openhands_runtime/migration.sql
|-- lib/agents/runtime.ts
|-- lib/agents/__tests__/runtime.test.ts
|-- lib/openrouter/models.ts
|-- lib/openrouter/__tests__/models.test.ts
|-- app/api/projects/[id]/models/route.ts
|-- app/api/projects/[id]/models/__tests__/route.test.ts
|-- components/chat/ModelPicker.tsx
|-- app/project/[id]/page.tsx
|-- container/sandbox/broker/src/agent-provider.ts
|-- container/sandbox/broker/src/agent-provider-factory.ts
|-- container/sandbox/broker/src/openhands-runner.ts
|-- container/sandbox/broker/src/openhands-bridge-events.ts
|-- container/sandbox/broker/python/openhands_bridge.py
|-- container/sandbox/broker/tests/agent-provider.test.ts
|-- container/sandbox/broker/tests/agent-provider-factory.test.ts
|-- container/sandbox/broker/tests/openhands-runner.test.ts
|-- container/sandbox/broker/tests/openhands-bridge-events.test.ts
|-- container/sandbox/Dockerfile
|-- lib/runtime/worker-pool/index.ts
|-- lib/runtime/worker-pool/__tests__/index.test.ts
|-- lib/runtime/daytona/cloud.ts
|-- .env.example
`-- docs/AGENT_RUNTIME_OPTIONS.md
```

## Subagent Decomposition

Use one implementer subagent per task, sequentially, because some tasks depend on earlier runtime types. Keep write ownership disjoint:

- Task 1 owner: protocol, Prisma, `lib/agents/runtime.ts`, runtime tests.
- Task 2 owner: `lib/openrouter/*`, project models API route/tests.
- Task 3 owner: `components/chat/ModelPicker.tsx`, `app/project/[id]/page.tsx`.
- Task 4 owner: TypeScript broker OpenHands parser/runner/factory/tests.
- Task 5 owner: Python bridge and sandbox image dependency installation.
- Task 6 owner: env pass-through and docs.
- Task 7 owner: verification only; no feature edits unless fixing failures.

---

## Task 1: Add OpenHands Runtime Identity

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260429090000_add_openhands_runtime/migration.sql`
- Modify: `lib/agents/runtime.ts`
- Create: `lib/agents/__tests__/runtime.test.ts`

- [ ] **Step 1: Write the failing runtime mapping tests**

Create `lib/agents/__tests__/runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_OPTIONS,
  dbRuntimeToProtocol,
  defaultModelForRuntime,
  isAgentRuntime,
  protocolRuntimeToDb,
  runtimeLabel,
  runtimeProviderLabel,
} from "../runtime";

describe("agent runtime mappings", () => {
  it("includes OpenHands as a selectable runtime", () => {
    expect(AGENT_RUNTIME_OPTIONS).toContainEqual({
      value: "openhands",
      label: "OpenHands",
      provider: "OpenHands SDK",
    });
    expect(isAgentRuntime("openhands")).toBe(true);
  });

  it("maps OpenHands between protocol and Prisma", () => {
    expect(protocolRuntimeToDb("openhands")).toBe("OPENHANDS");
    expect(dbRuntimeToProtocol("OPENHANDS")).toBe("openhands");
  });

  it("returns labels and default model for OpenHands", () => {
    expect(runtimeLabel("openhands")).toBe("OpenHands");
    expect(runtimeProviderLabel("openhands")).toBe("OpenHands SDK");
    expect(defaultModelForRuntime("openhands")).toBe("openrouter:qwen/qwen3-coder:free");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test:host -- lib/agents/__tests__/runtime.test.ts
```

Expected: FAIL because `openhands` is not in the protocol type, Prisma enum mapping, or runtime option list.

- [ ] **Step 3: Add `openhands` to the shared protocol**

In `packages/protocol/src/index.ts`, change:

```ts
export type AgentRuntime = "claude-code" | "openai-codex" | "vercel-ai";
```

to:

```ts
export type AgentRuntime = "claude-code" | "openai-codex" | "vercel-ai" | "openhands";
```

Bump the protocol version at the bottom:

```ts
export const PROTOCOL_VERSION = "1.10.0" as const;
```

- [ ] **Step 4: Add Prisma enum and migration**

In `prisma/schema.prisma`, add `OPENHANDS` to `enum AgentRuntime`:

```prisma
enum AgentRuntime {
  CLAUDE_CODE
  OPENAI_CODEX
  VERCEL_AI
  OPENHANDS
}
```

Create `prisma/migrations/20260429090000_add_openhands_runtime/migration.sql`:

```sql
ALTER TYPE "AgentRuntime" ADD VALUE 'OPENHANDS';
```

- [ ] **Step 5: Update runtime helpers**

In `lib/agents/runtime.ts`, add the option:

```ts
{ value: "openhands", label: "OpenHands", provider: "OpenHands SDK" },
```

Add mappings:

```ts
"openhands": "OPENHANDS",
```

and:

```ts
OPENHANDS: "openhands",
```

Add the default model case:

```ts
case "openhands":
  return process.env.OPENHANDS_MODEL?.trim() || "openrouter:qwen/qwen3-coder:free";
```

- [ ] **Step 6: Verify the runtime tests pass**

Run:

```bash
pnpm test:host -- lib/agents/__tests__/runtime.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS and typecheck clean.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/protocol/src/index.ts prisma/schema.prisma prisma/migrations/20260429090000_add_openhands_runtime/migration.sql lib/agents/runtime.ts lib/agents/__tests__/runtime.test.ts
git commit -m "feat(runtime): add openhands runtime identity"
```

---

## Task 2: Add OpenRouter Model Catalog API

**Files:**
- Create: `lib/openrouter/models.ts`
- Create: `lib/openrouter/__tests__/models.test.ts`
- Create: `app/api/projects/[id]/models/route.ts`
- Create: `app/api/projects/[id]/models/__tests__/route.test.ts`

- [ ] **Step 1: Write failing pure normalization tests**

Create `lib/openrouter/__tests__/models.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeOpenRouterModels } from "../models";

describe("normalizeOpenRouterModels", () => {
  it("keeps only text models with tool support and prefixes ids", () => {
    const models = normalizeOpenRouterModels({
      data: [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen: Qwen3 Coder (free)",
          context_length: 1048576,
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["tools", "temperature"],
        },
        {
          id: "image/model",
          name: "Image Model",
          context_length: 4096,
          architecture: { input_modalities: ["text"], output_modalities: ["image"] },
          pricing: { prompt: "1", completion: "1" },
          supported_parameters: ["temperature"],
        },
      ],
    });

    expect(models).toEqual([
      {
        id: "openrouter:qwen/qwen3-coder:free",
        label: "Qwen: Qwen3 Coder (free)",
        contextLength: 1048576,
        promptPrice: "0",
        completionPrice: "0",
        supportedParameters: ["tools", "temperature"],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the failing pure test**

Run:

```bash
pnpm test:host -- lib/openrouter/__tests__/models.test.ts
```

Expected: FAIL because `lib/openrouter/models.ts` does not exist.

- [ ] **Step 3: Implement OpenRouter model normalization and fetch**

Create `lib/openrouter/models.ts`:

```ts
export type OpenRouterModelOption = {
  id: string;
  label: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
};

type RawOpenRouterModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  supported_parameters?: unknown;
};

type RawOpenRouterResponse = {
  data?: unknown;
};

const MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeOpenRouterModels(payload: RawOpenRouterResponse): OpenRouterModelOption[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.flatMap((row): OpenRouterModelOption[] => {
    const model = row as RawOpenRouterModel;
    if (typeof model.id !== "string" || typeof model.name !== "string") return [];
    const outputModalities = stringArray(model.architecture?.output_modalities);
    const supportedParameters = stringArray(model.supported_parameters);
    if (!outputModalities.includes("text")) return [];
    if (!supportedParameters.includes("tools")) return [];
    return [{
      id: `openrouter:${model.id}`,
      label: model.name,
      contextLength: typeof model.context_length === "number" ? model.context_length : 0,
      promptPrice: nullableString(model.pricing?.prompt),
      completionPrice: nullableString(model.pricing?.completion),
      supportedParameters,
    }];
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchOpenRouterModels(fetchImpl: typeof fetch = fetch): Promise<OpenRouterModelOption[]> {
  const res = await fetchImpl(MODELS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`OpenRouter models request failed: HTTP ${res.status}`);
  const payload = await res.json() as RawOpenRouterResponse;
  return normalizeOpenRouterModels(payload);
}
```

- [ ] **Step 4: Verify pure model tests pass**

Run:

```bash
pnpm test:host -- lib/openrouter/__tests__/models.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Create `app/api/projects/[id]/models/__tests__/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET } from "../route";

const DEV_USER_ID = "dev-user";
process.env.DEV_USER_ID = DEV_USER_ID;

describe("GET /api/projects/[id]/models", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.message.deleteMany({});
    await prisma.sessionRuntimeState.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.user.create({ data: { id: DEV_USER_ID, email: "dev@example.com" } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.message.deleteMany({});
    await prisma.sessionRuntimeState.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("returns 404 for another user's project", async () => {
    const res = await GET(new Request("http://localhost/api/projects/missing/models"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns normalized OpenRouter models for the project owner", async () => {
    await prisma.project.create({
      data: {
        id: "p1",
        ownerId: DEV_USER_ID,
        name: "Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: "qwen/qwen3-coder:free",
        name: "Qwen Coder",
        context_length: 1048576,
        architecture: { output_modalities: ["text"] },
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
      }],
    }), { status: 200 })));

    const res = await GET(new Request("http://localhost/api/projects/p1/models"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      models: [{
        id: "openrouter:qwen/qwen3-coder:free",
        label: "Qwen Coder",
        contextLength: 1048576,
        promptPrice: "0",
        completionPrice: "0",
        supportedParameters: ["tools"],
      }],
    });
  });
});
```

- [ ] **Step 6: Run the failing route tests**

Run:

```bash
pnpm test:host -- app/api/projects/[id]/models/__tests__/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 7: Implement the route**

Create `app/api/projects/[id]/models/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fetchOpenRouterModels } from "@/lib/openrouter/models";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const models = await fetchOpenRouterModels();
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter models request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 8: Verify API/model tests pass**

Run:

```bash
pnpm test:host -- lib/openrouter/__tests__/models.test.ts app/api/projects/[id]/models/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add lib/openrouter app/api/projects/[id]/models
git commit -m "feat(openrouter): add model catalog endpoint"
```

---

## Task 3: Add Searchable Model Picker UI

**Files:**
- Create: `components/chat/ModelPicker.tsx`
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Add the model option types and component**

Create `components/chat/ModelPicker.tsx`:

```tsx
"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ModelOption = {
  id: string;
  label: string;
  contextLength: number;
  promptPrice: string | null;
  completionPrice: string | null;
  supportedParameters: string[];
};

export type ModelPickerProps = {
  models: ModelOption[];
  selectedModelId: string | null;
  loading: boolean;
  disabled: boolean;
  onSelect: (modelId: string) => void;
};

function formatContext(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}

export function ModelPicker({
  models,
  selectedModelId,
  loading,
  disabled,
  onSelect,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === selectedModelId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models.slice(0, 40);
    return models.filter((model) =>
      `${model.label} ${model.id}`.toLowerCase().includes(q),
    ).slice(0, 40);
  }, [models, query]);

  return (
    <div className="relative min-w-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="max-w-64 justify-between"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{selected?.label ?? (loading ? "Loading models..." : "Select model")}</span>
        <ChevronsUpDown className="size-3.5" aria-hidden="true" />
      </Button>
      {open && (
        <div className="absolute left-0 top-10 z-20 w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-card p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search OpenRouter models"
              className="h-9 pl-8"
            />
          </div>
          <ul role="listbox" className="mt-2 max-h-72 overflow-y-auto">
            {filtered.map((model) => {
              const active = model.id === selectedModelId;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onSelect(model.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                      active && "bg-secondary",
                    )}
                  >
                    <Check className={cn("mt-0.5 size-4 opacity-0", active && "opacity-100")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{model.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{model.id}</span>
                    </span>
                    {model.contextLength > 0 && (
                      <Badge variant="outline">{formatContext(model.contextLength)}</Badge>
                    )}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">No models found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate model state into the workspace page**

In `app/project/[id]/page.tsx`, import the picker:

```ts
import { ModelPicker, type ModelOption } from "@/components/chat/ModelPicker";
```

Add state near existing runtime/session state:

```ts
const [openRouterModels, setOpenRouterModels] = useState<ModelOption[]>([]);
const [modelsLoading, setModelsLoading] = useState(false);
const [modelsError, setModelsError] = useState<string | null>(null);
```

Add helper functions near `runtimeStateForSession`:

```ts
function supportsOpenRouterModelPicker(runtime: AgentRuntime): boolean {
  return runtime === "openhands" || runtime === "vercel-ai";
}

function selectedModelForSession(session: ChatSession | null, runtime: AgentRuntime): string | null {
  return runtimeStateForSession(session, runtime)?.modelId ?? null;
}
```

- [ ] **Step 3: Load models when the selected runtime supports the picker**

Add this effect after project/session loading effects:

```ts
useEffect(() => {
  if (!supportsOpenRouterModelPicker(selectedRuntime)) return;
  if (openRouterModels.length > 0 || modelsLoading) return;
  let cancelled = false;
  setModelsLoading(true);
  setModelsError(null);
  fetch(`/api/projects/${id}/models`)
    .then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ models: ModelOption[] }>;
    })
    .then((data) => {
      if (!cancelled) setOpenRouterModels(data.models);
    })
    .catch((error) => {
      if (!cancelled) setModelsError(error instanceof Error ? error.message : "model list failed");
    })
    .finally(() => {
      if (!cancelled) setModelsLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [id, modelsLoading, openRouterModels.length, selectedRuntime]);
```

- [ ] **Step 4: Persist selected model into existing runtime state**

Add this function near `setSessionDefaultRuntime`:

```ts
async function setSessionRuntimeModel(modelId: string) {
  const session = activeSessionRef.current;
  const runtime = selectedRuntimeRef.current;
  if (!session || !supportsOpenRouterModelPicker(runtime)) return;
  const runtimeState = runtimeStateForSession(session, runtime);
  const providerSessionId = runtimeState?.providerSessionId ?? crypto.randomUUID();
  await syncRuntimeState(runtime, providerSessionId, modelId);
}
```

- [ ] **Step 5: Render the picker under the runtime buttons**

Below the existing runtime button row, add:

```tsx
{supportsOpenRouterModelPicker(selectedRuntime) && (
  <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/45 px-3 py-2">
    <ModelPicker
      models={openRouterModels}
      selectedModelId={selectedModelForSession(activeSession, selectedRuntime)}
      loading={modelsLoading}
      disabled={turnInFlight !== null || sessionLoading || !activeSession}
      onSelect={(modelId) => void setSessionRuntimeModel(modelId)}
    />
    {modelsError && (
      <span className="truncate text-xs text-red-200">{modelsError}</span>
    )}
  </div>
)}
```

- [ ] **Step 6: Verify UI typecheck**

Run:

```bash
pnpm exec tsc --noEmit
pnpm build
```

Expected: typecheck and build pass. If `pnpm build` fails because the local database is unavailable, record the exact error and run `pnpm test:host` plus `pnpm -F @wbd/broker test`.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add components/chat/ModelPicker.tsx app/project/[id]/page.tsx
git commit -m "feat(ui): add openrouter model picker"
```

---

## Task 4: Add TypeScript OpenHands Broker Runner

**Files:**
- Modify: `container/sandbox/broker/src/agent-provider.ts`
- Modify: `container/sandbox/broker/src/agent-provider-factory.ts`
- Create: `container/sandbox/broker/src/openhands-bridge-events.ts`
- Create: `container/sandbox/broker/src/openhands-runner.ts`
- Create: `container/sandbox/broker/tests/agent-provider.test.ts`
- Create: `container/sandbox/broker/tests/agent-provider-factory.test.ts`
- Create: `container/sandbox/broker/tests/openhands-bridge-events.test.ts`
- Create: `container/sandbox/broker/tests/openhands-runner.test.ts`

- [ ] **Step 1: Write failing bridge event parser tests**

Create `container/sandbox/broker/tests/openhands-bridge-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseOpenHandsBridgeLine } from "../src/openhands-bridge-events";

describe("parseOpenHandsBridgeLine", () => {
  it("maps chunk events", () => {
    expect(parseOpenHandsBridgeLine(
      JSON.stringify({ type: "chunk", delta: "Done", agentId: "coder" }),
      "turn-1",
    )).toEqual({ type: "agent.chunk", turnId: "turn-1", delta: "Done", agentId: "coder" });
  });

  it("maps writing status and tool events", () => {
    expect(parseOpenHandsBridgeLine(
      JSON.stringify({ type: "tool", tool: "Write", input: { path: "app/page.tsx" } }),
      "turn-1",
    )).toEqual({
      type: "agent.tool_use",
      turnId: "turn-1",
      tool: "Write",
      input: { path: "app/page.tsx" },
    });
  });

  it("ignores invalid json lines", () => {
    expect(parseOpenHandsBridgeLine("not json", "turn-1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing parser test**

Run:

```bash
pnpm -F @wbd/broker test -- tests/openhands-bridge-events.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement bridge event parser**

Create `container/sandbox/broker/src/openhands-bridge-events.ts`:

```ts
import type { BrokerToHost, AgentUsageDetails } from "@wbd/protocol";

type BridgeEvent =
  | { type: "status"; phase?: unknown; detail?: unknown; agentId?: unknown }
  | { type: "chunk"; delta?: unknown; agentId?: unknown }
  | { type: "tool"; tool?: unknown; input?: unknown; agentId?: unknown }
  | { type: "done"; durationMs?: unknown; tokensIn?: unknown; tokensOut?: unknown; costUsd?: unknown; usage?: unknown }
  | { type: "error"; message?: unknown; agentId?: unknown };

const STATUS_PHASES = new Set(["starting", "thinking", "tool_use", "writing_file"]);

function optionalAgentId(value: unknown): { agentId?: string } {
  return typeof value === "string" && value ? { agentId: value } : {};
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageDetails(value: unknown, tokensIn: number, tokensOut: number): AgentUsageDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  return {
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: tokensIn + tokensOut,
    webSearchRequests: 0,
    webFetchRequests: 0,
    rawUsage: value,
    modelUsage: value,
  };
}

export function parseOpenHandsBridgeLine(line: string, turnId: string): BrokerToHost | null {
  let parsed: BridgeEvent;
  try {
    parsed = JSON.parse(line) as BridgeEvent;
  } catch {
    return null;
  }

  if (parsed.type === "chunk" && typeof parsed.delta === "string") {
    return { type: "agent.chunk", turnId, delta: parsed.delta, ...optionalAgentId(parsed.agentId) };
  }
  if (parsed.type === "tool" && typeof parsed.tool === "string") {
    return { type: "agent.tool_use", turnId, tool: parsed.tool, input: parsed.input, ...optionalAgentId(parsed.agentId) };
  }
  if (parsed.type === "status" && typeof parsed.phase === "string" && STATUS_PHASES.has(parsed.phase)) {
    return {
      type: "agent.status",
      turnId,
      phase: parsed.phase as "starting" | "thinking" | "tool_use" | "writing_file",
      ...(typeof parsed.detail === "string" ? { detail: parsed.detail } : {}),
      ...optionalAgentId(parsed.agentId),
    };
  }
  if (parsed.type === "error" && typeof parsed.message === "string") {
    return { type: "agent.error", turnId, message: parsed.message, ...optionalAgentId(parsed.agentId) };
  }
  if (parsed.type === "done") {
    const tokensIn = numberOrZero(parsed.tokensIn);
    const tokensOut = numberOrZero(parsed.tokensOut);
    const usage = usageDetails(parsed.usage, tokensIn, tokensOut);
    return {
      type: "agent.done",
      turnId,
      durationMs: numberOrZero(parsed.durationMs),
      tokensIn,
      tokensOut,
      costUsd: numberOrZero(parsed.costUsd),
      exitCode: 0,
      ...(usage ? { usage } : {}),
    };
  }
  return null;
}
```

- [ ] **Step 4: Write failing provider and runner tests**

Create `container/sandbox/broker/tests/agent-provider.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { agentRuntimeFromEnv } from "../src/agent-provider";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("agentRuntimeFromEnv", () => {
  it("parses OpenHands aliases", () => {
    process.env.AGENT_RUNTIME = "open-hands";
    expect(agentRuntimeFromEnv()).toBe("openhands");
    process.env.AGENT_RUNTIME = "openhands-sdk";
    expect(agentRuntimeFromEnv()).toBe("openhands");
  });
});
```

Create `container/sandbox/broker/tests/agent-provider-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentProvider } from "../src/agent-provider-factory";

describe("createAgentProvider", () => {
  it("creates OpenHands provider", () => {
    const provider = createAgentProvider({ runtime: "openhands" });
    expect(provider.runtime).toBe("openhands");
    expect(typeof provider.runTurn).toBe("function");
  });
});
```

Create `container/sandbox/broker/tests/openhands-runner.test.ts` with a fake spawn:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOpenHandsModelId, runOpenHandsTurn, type OpenHandsSpawnFn } from "../src/openhands-runner";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function fakeSpawn(lines: string[]): OpenHandsSpawnFn {
  return () => {
    const child = new EventEmitter() as ReturnType<OpenHandsSpawnFn>;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    child.once = child.once.bind(child) as ReturnType<OpenHandsSpawnFn>["once"];
    queueMicrotask(() => {
      for (const line of lines) child.stdout?.write(`${line}\n`);
      child.stdout?.end();
      child.emit("close", 0);
    });
    return child;
  };
}

describe("openhands runner", () => {
  it("normalizes OpenRouter model ids for LiteLLM", () => {
    expect(normalizeOpenHandsModelId("openrouter:qwen/qwen3-coder:free")).toBe("openrouter/qwen/qwen3-coder:free");
  });

  it("reports missing OpenRouter key for OpenRouter models", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const events: unknown[] = [];
    await runOpenHandsTurn({
      projectId: "p1",
      sessionId: "s1",
      resumeSession: false,
      prompt: "hi",
      turnId: "t1",
      modelId: "openrouter:qwen/qwen3-coder:free",
      onEvent: (event) => events.push(event),
    }, { spawn: fakeSpawn([]) });
    expect(events).toContainEqual({
      type: "agent.error",
      turnId: "t1",
      message: "openhands runtime model 'openrouter:qwen/qwen3-coder:free' requires OPENROUTER_API_KEY.",
    });
  });

  it("streams bridge JSONL as broker events", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const events: unknown[] = [];
    await runOpenHandsTurn({
      projectId: "p1",
      sessionId: "s1",
      resumeSession: false,
      prompt: "hi",
      turnId: "t1",
      modelId: "openrouter:qwen/qwen3-coder:free",
      onEvent: (event) => events.push(event),
    }, { spawn: fakeSpawn([
      JSON.stringify({ type: "chunk", delta: "Hello" }),
      JSON.stringify({ type: "done", durationMs: 10, tokensIn: 1, tokensOut: 2, costUsd: 0 }),
    ]) });
    expect(events).toEqual([
      { type: "agent.chunk", turnId: "t1", delta: "Hello" },
      { type: "agent.done", turnId: "t1", durationMs: 10, tokensIn: 1, tokensOut: 2, costUsd: 0, exitCode: 0 },
    ]);
  });
});
```

- [ ] **Step 5: Run failing provider/runner tests**

Run:

```bash
pnpm -F @wbd/broker test -- tests/agent-provider.test.ts tests/agent-provider-factory.test.ts tests/openhands-runner.test.ts
```

Expected: FAIL because runtime parsing, factory branch, and runner do not exist.

- [ ] **Step 6: Update provider parsing and factory**

In `container/sandbox/broker/src/agent-provider.ts`, add:

```ts
if (raw === "openhands" || raw === "open-hands" || raw === "openhands-sdk") {
  return "openhands";
}
```

In `container/sandbox/broker/src/agent-provider-factory.ts`, import:

```ts
import { runOpenHandsReviewPass, runOpenHandsTurn } from "./openhands-runner";
```

Add branch before default Claude branch:

```ts
if (runtime === "openhands") {
  return {
    runtime,
    runTurn: (turn) => runOpenHandsTurn(turn),
    runReview: (review) => runOpenHandsReviewPass(review),
  };
}
```

- [ ] **Step 7: Implement the TypeScript OpenHands runner**

Create `container/sandbox/broker/src/openhands-runner.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { BrokerToHost } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";
import { parseOpenHandsBridgeLine } from "./openhands-bridge-events";

const DEFAULT_MODEL = "openrouter:qwen/qwen3-coder:free";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const BRIDGE_PATH = "/opt/builder/container/sandbox/broker/python/openhands_bridge.py";
const PROJECT_ROOT = "/workspace/project";
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";

export interface OpenHandsChild {
  stdout: Readable | null;
  stderr: Readable | null;
  stdin: Writable | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once(event: "close", listener: (code: number | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
}

export type OpenHandsSpawnFn = (
  cmd: string,
  args: string[],
  options: Parameters<typeof nodeSpawn>[2],
) => OpenHandsChild;

export interface OpenHandsRunnerDeps {
  spawn?: OpenHandsSpawnFn;
}

export function normalizeOpenHandsModelId(modelId: string | undefined): string {
  const candidate = (modelId || process.env.OPENHANDS_MODEL || DEFAULT_MODEL).trim();
  if (candidate.startsWith("openrouter:")) return `openrouter/${candidate.slice("openrouter:".length)}`;
  return candidate;
}

function uiModelId(modelId: string | undefined): string {
  return (modelId || process.env.OPENHANDS_MODEL || DEFAULT_MODEL).trim();
}

function missingApiKeyMessage(modelId: string): string | undefined {
  if (modelId.startsWith("openrouter:") && !process.env.OPENROUTER_API_KEY) {
    return `openhands runtime model '${modelId}' requires OPENROUTER_API_KEY.`;
  }
  if (!modelId.startsWith("openrouter:") && !process.env.LLM_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return `openhands runtime model '${modelId}' requires LLM_API_KEY or OPENROUTER_API_KEY.`;
  }
  return undefined;
}

function bridgeEnv(modelId: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LLM_MODEL: normalizeOpenHandsModelId(modelId),
    LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || "",
    LLM_BASE_URL: process.env.OPENHANDS_BASE_URL || process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
    OPENHANDS_MAX_ITERATIONS: process.env.OPENHANDS_MAX_ITERATIONS || "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: process.env.OPENHANDS_ENABLE_PUBLIC_SKILLS || "0",
  };
}

async function runBridge(args: {
  prompt: string;
  sessionId: string;
  turnId: string;
  modelId: string;
  agentId?: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
}, deps: OpenHandsRunnerDeps): Promise<void> {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as OpenHandsSpawnFn);
  const child = spawnFn("python3", [
    BRIDGE_PATH,
    "--session",
    args.sessionId,
    "--workspace",
    PROJECT_ROOT,
    "--model",
    normalizeOpenHandsModelId(args.modelId),
    "--prompt",
    args.prompt,
  ], {
    cwd: PROJECT_ROOT,
    env: bridgeEnv(args.modelId),
    stdio: ["pipe", "pipe", "pipe"],
  });

  let sawTerminal = false;
  let aborted = false;
  let stderrTail = "";
  let buffer = "";

  const emit = (event: BrokerToHost) => {
    const tagged = args.agentId && (
      event.type === "agent.chunk" ||
      event.type === "agent.status" ||
      event.type === "agent.tool_use" ||
      event.type === "agent.error"
    ) ? { ...event, agentId: args.agentId } as BrokerToHost : event;
    if (tagged.type === "agent.done" || tagged.type === "agent.error") sawTerminal = true;
    args.onEvent(tagged);
  };

  const killChild = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  };

  args.signal?.addEventListener("abort", () => {
    aborted = true;
    killChild();
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const event = parseOpenHandsBridgeLine(line, args.turnId);
      if (event) emit(event);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
  });

  await new Promise<void>((resolve) => {
    child.once("close", (code) => {
      if (buffer.trim()) {
        const event = parseOpenHandsBridgeLine(buffer, args.turnId);
        if (event) emit(event);
      }
      if (aborted && !sawTerminal) {
        emit({ type: "agent.done", turnId: args.turnId, durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, exitCode: -1 });
      } else if (!sawTerminal) {
        emit({ type: "agent.error", turnId: args.turnId, message: `OpenHands exited with code ${code ?? "unknown"}${stderrTail ? `\n${stderrTail}` : ""}` });
      }
      resolve();
    });
    child.once("error", (err) => {
      if (!sawTerminal) emit({ type: "agent.error", turnId: args.turnId, message: err.message });
      resolve();
    });
  });
}

export async function runOpenHandsTurn(opts: AgentTurnOptions, deps: OpenHandsRunnerDeps = {}): Promise<void> {
  const modelId = uiModelId(opts.modelId);
  const missing = missingApiKeyMessage(modelId);
  if (missing) {
    opts.onEvent({ type: "agent.error", turnId: opts.turnId, message: missing });
    return;
  }
  opts.onEvent({ type: "agent.status", turnId: opts.turnId, phase: "starting" });
  await runBridge({
    prompt: opts.prompt,
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    modelId,
    onEvent: opts.onEvent,
    signal: opts.signal,
  }, deps);
}

export async function runOpenHandsReviewPass(opts: AgentReviewOptions, deps: OpenHandsRunnerDeps = {}): Promise<void> {
  const modelId = process.env.OPENHANDS_REVIEWER_MODEL || process.env.OPENHANDS_MODEL || DEFAULT_MODEL;
  if (missingApiKeyMessage(modelId)) return;
  await runBridge({
    prompt: REVIEWER_PROMPT,
    sessionId: `review-${opts.turnId}`,
    turnId: opts.turnId,
    modelId,
    agentId: "reviewer",
    onEvent: opts.onEvent,
    signal: opts.signal,
  }, deps);
}
```

- [ ] **Step 8: Verify broker runner tests pass**

Run:

```bash
pnpm -F @wbd/broker test -- tests/agent-provider.test.ts tests/agent-provider-factory.test.ts tests/openhands-bridge-events.test.ts tests/openhands-runner.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add container/sandbox/broker/src/agent-provider.ts container/sandbox/broker/src/agent-provider-factory.ts container/sandbox/broker/src/openhands-bridge-events.ts container/sandbox/broker/src/openhands-runner.ts container/sandbox/broker/tests/agent-provider.test.ts container/sandbox/broker/tests/agent-provider-factory.test.ts container/sandbox/broker/tests/openhands-bridge-events.test.ts container/sandbox/broker/tests/openhands-runner.test.ts
git commit -m "feat(broker): add openhands agent provider"
```

---

## Task 5: Add Python OpenHands Bridge and Sandbox Dependencies

**Files:**
- Create: `container/sandbox/broker/python/openhands_bridge.py`
- Modify: `container/sandbox/Dockerfile`

- [ ] **Step 1: Add the Python bridge script**

Create `container/sandbox/broker/python/openhands_bridge.py`:

```py
#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from pathlib import Path


def emit(event):
    print(json.dumps(event, separators=(",", ":")), flush=True)


def load_openhands():
    from openhands.sdk import Agent, AgentContext, Conversation, LLM, Tool
    from openhands.sdk.context.skills import load_project_skills, load_skills_from_dir
    from openhands.sdk.subagent import register_file_agents
    from openhands.sdk.tool import register_tool
    from openhands.tools.delegate import DelegateTool
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.task_tracker import TaskTrackerTool
    from openhands.tools.terminal import TerminalTool
    from openhands.tools.preset.default import register_builtins_agents

    return {
        "Agent": Agent,
        "AgentContext": AgentContext,
        "Conversation": Conversation,
        "LLM": LLM,
        "Tool": Tool,
        "load_project_skills": load_project_skills,
        "load_skills_from_dir": load_skills_from_dir,
        "register_file_agents": register_file_agents,
        "register_tool": register_tool,
        "DelegateTool": DelegateTool,
        "FileEditorTool": FileEditorTool,
        "TaskTrackerTool": TaskTrackerTool,
        "TerminalTool": TerminalTool,
        "register_builtins_agents": register_builtins_agents,
    }


class JsonlVisualizer:
    def initialize(self, state):
        self.state = state

    def create_sub_visualizer(self, agent_id):
        child = JsonlVisualizer()
        child.agent_id = agent_id
        return child

    def on_event(self, event):
        event_type = event.__class__.__name__
        agent_id = getattr(self, "agent_id", None)
        if event_type == "MessageEvent" and getattr(event, "source", None) == "agent":
            text = getattr(getattr(event, "llm_message", None), "content", None)
            if isinstance(text, str) and text:
                payload = {"type": "chunk", "delta": text}
                if agent_id:
                    payload["agentId"] = agent_id
                emit(payload)
        elif event_type.endswith("ActionEvent"):
            tool_name = getattr(event, "tool_name", event_type.replace("ActionEvent", ""))
            payload = {"type": "tool", "tool": tool_name, "input": getattr(event, "model_dump", lambda: {})()}
            if agent_id:
                payload["agentId"] = agent_id
            emit(payload)


def build_agent(mod, workspace):
    skills = []
    try:
        skills.extend(mod["load_project_skills"](workspace_dir=workspace))
    except Exception:
        pass

    skills_dir = Path(workspace) / ".openhands" / "skills"
    if skills_dir.exists():
        try:
            repo_skills, knowledge_skills, agent_skills = mod["load_skills_from_dir"](skills_dir)
            skills.extend(repo_skills.values())
            skills.extend(knowledge_skills.values())
            skills.extend(agent_skills.values())
        except Exception:
            pass

    mod["register_tool"]("DelegateTool", mod["DelegateTool"])
    try:
        mod["register_builtins_agents"]()
    except Exception:
        pass
    try:
        mod["register_file_agents"](workspace)
    except Exception:
        pass

    llm = mod["LLM"](
        model=os.environ["LLM_MODEL"],
        api_key=os.environ.get("LLM_API_KEY"),
        base_url=os.environ.get("LLM_BASE_URL"),
    )
    context = mod["AgentContext"](
        skills=skills,
        load_public_skills=os.environ.get("OPENHANDS_ENABLE_PUBLIC_SKILLS") == "1",
    )
    return mod["Agent"](
        llm=llm,
        tools=[
            mod["Tool"](name=mod["TerminalTool"].name),
            mod["Tool"](name=mod["FileEditorTool"].name),
            mod["Tool"](name=mod["TaskTrackerTool"].name),
            mod["Tool"](name=mod["DelegateTool"].name),
        ],
        agent_context=context,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt", required=True)
    args = parser.parse_args()

    started_at = time.time()
    os.environ["LLM_MODEL"] = args.model
    emit({"type": "status", "phase": "starting"})
    try:
        mod = load_openhands()
        agent = build_agent(mod, args.workspace)
        conversation = mod["Conversation"](
            agent=agent,
            workspace=args.workspace,
            visualizer=JsonlVisualizer(),
            max_iterations=int(os.environ.get("OPENHANDS_MAX_ITERATIONS", "30")),
        )
        emit({"type": "status", "phase": "thinking"})
        conversation.send_message(args.prompt)
        conversation.run()
        stats = conversation.conversation_stats.get_combined_metrics()
        usage = stats.get() if hasattr(stats, "get") else {}
        emit({
            "type": "done",
            "durationMs": int((time.time() - started_at) * 1000),
            "tokensIn": int(usage.get("input_tokens", 0) or 0),
            "tokensOut": int(usage.get("output_tokens", 0) or 0),
            "costUsd": float(usage.get("accumulated_cost", 0) or 0),
            "usage": usage,
        })
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Install Python and OpenHands packages in the sandbox image**

In `container/sandbox/Dockerfile`, update the runtime image install block to include Python:

```dockerfile
RUN corepack enable && corepack prepare pnpm@10 --activate \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip \
 && python3 -m pip install --break-system-packages --no-cache-dir openhands-sdk openhands-tools \
 && rm -rf /var/lib/apt/lists/*
```

Make sure the existing `COPY container/sandbox/broker/ /opt/builder/container/sandbox/broker/` copies the new `python/` directory.

- [ ] **Step 3: Run syntax and broker tests**

Run:

```bash
python3 -m py_compile container/sandbox/broker/python/openhands_bridge.py
pnpm -F @wbd/broker test -- tests/openhands-runner.test.ts tests/openhands-bridge-events.test.ts
```

Expected: Python syntax check passes and broker tests remain green.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add container/sandbox/broker/python/openhands_bridge.py container/sandbox/Dockerfile
git commit -m "feat(openhands): add python bridge"
```

---

## Task 6: Wire Environment Pass-through and Documentation

**Files:**
- Modify: `lib/runtime/worker-pool/index.ts`
- Modify: `lib/runtime/worker-pool/__tests__/index.test.ts`
- Modify: `lib/runtime/daytona/cloud.ts`
- Modify: `.env.example`
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md`

- [ ] **Step 1: Write failing worker-pool env test**

Append this test to `lib/runtime/worker-pool/__tests__/index.test.ts`:

```ts
it("passes OpenHands settings into sandboxes", () => {
  expect(collectBrokerEnv({
    AGENT_RUNTIME: "openhands",
    OPENROUTER_API_KEY: "sk-or-v1-test",
    OPENHANDS_MODEL: "openrouter:qwen/qwen3-coder:free",
    OPENHANDS_REVIEWER_MODEL: "openrouter:qwen/qwen3-coder:free",
    OPENHANDS_BASE_URL: "https://openrouter.ai/api/v1",
    OPENHANDS_MAX_ITERATIONS: "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: "0",
  })).toMatchObject({
    AGENT_RUNTIME: "openhands",
    OPENROUTER_API_KEY: "sk-or-v1-test",
    OPENHANDS_MODEL: "openrouter:qwen/qwen3-coder:free",
    OPENHANDS_REVIEWER_MODEL: "openrouter:qwen/qwen3-coder:free",
    OPENHANDS_BASE_URL: "https://openrouter.ai/api/v1",
    OPENHANDS_MAX_ITERATIONS: "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: "0",
  });
});
```

- [ ] **Step 2: Run the failing env test**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/index.test.ts
```

Expected: FAIL because OpenHands env vars are not passed through yet.

- [ ] **Step 3: Add OpenHands env pass-through**

In `lib/runtime/worker-pool/index.ts`, add to `passthrough`:

```ts
"OPENHANDS_MODEL",
"OPENHANDS_REVIEWER_MODEL",
"OPENHANDS_BASE_URL",
"OPENHANDS_MAX_ITERATIONS",
"OPENHANDS_ENABLE_PUBLIC_SKILLS",
"LLM_API_KEY",
"LLM_BASE_URL",
```

In `lib/runtime/daytona/cloud.ts`, add to `envVars`:

```ts
OPENHANDS_MODEL: process.env.OPENHANDS_MODEL ?? "",
OPENHANDS_REVIEWER_MODEL: process.env.OPENHANDS_REVIEWER_MODEL ?? "",
OPENHANDS_BASE_URL: process.env.OPENHANDS_BASE_URL ?? "",
OPENHANDS_MAX_ITERATIONS: process.env.OPENHANDS_MAX_ITERATIONS ?? "",
OPENHANDS_ENABLE_PUBLIC_SKILLS: process.env.OPENHANDS_ENABLE_PUBLIC_SKILLS ?? "",
LLM_API_KEY: process.env.LLM_API_KEY ?? "",
LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",
```

- [ ] **Step 4: Update `.env.example`**

Add:

```env
# Auth/config for AGENT_RUNTIME=openhands. Uses OpenRouter by default.
OPENHANDS_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_REVIEWER_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_BASE_URL=https://openrouter.ai/api/v1
OPENHANDS_MAX_ITERATIONS=30
OPENHANDS_ENABLE_PUBLIC_SKILLS=0
```

Also update the runtime selector comment to include:

```env
#   - openhands: OpenHands SDK via local Python bridge
```

- [ ] **Step 5: Update runtime documentation**

In `docs/AGENT_RUNTIME_OPTIONS.md`, add this section:

````md
### `openhands`

Runs the OpenHands SDK through a local Python bridge inside the sandbox broker.
The broker keeps the existing WebSocket protocol and maps bridge JSONL into
`agent.*` events. OpenRouter model IDs are selected in the UI and stored in
`SessionRuntimeState.modelId`.

Configuration:

```env
AGENT_RUNTIME=openhands
OPENROUTER_API_KEY=sk-or-v1-...
OPENHANDS_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_REVIEWER_MODEL=openrouter:qwen/qwen3-coder:free
OPENHANDS_BASE_URL=https://openrouter.ai/api/v1
OPENHANDS_MAX_ITERATIONS=30
OPENHANDS_ENABLE_PUBLIC_SKILLS=0
```

Skills and sub-agents:

- Project `AGENTS.md` is loaded through OpenHands project skills.
- Optional local skills can live in `/workspace/project/.openhands/skills`.
- File-based agents can be registered from project agent directories.
- `DelegateTool` is enabled so the OpenHands orchestrator can spawn sub-agents.
````

- [ ] **Step 6: Verify env and docs task**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/index.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS and typecheck clean.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add lib/runtime/worker-pool/index.ts lib/runtime/worker-pool/__tests__/index.test.ts lib/runtime/daytona/cloud.ts .env.example docs/AGENT_RUNTIME_OPTIONS.md
git commit -m "docs(openhands): document runtime configuration"
```

---

## Task 7: Final Verification and Integration Review

**Files:**
- No planned feature files. Only fix scoped failures found by verification.

- [ ] **Step 1: Run focused suites**

Run:

```bash
pnpm -F @wbd/broker test -- tests/agent-provider.test.ts tests/agent-provider-factory.test.ts tests/openhands-bridge-events.test.ts tests/openhands-runner.test.ts tests/vercel-ai-runner.test.ts
pnpm test:host -- lib/agents/__tests__/runtime.test.ts lib/openrouter/__tests__/models.test.ts app/api/projects/[id]/models/__tests__/route.test.ts lib/runtime/worker-pool/__tests__/index.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run package-wide checks**

Run:

```bash
pnpm -F @wbd/broker test
pnpm test:host
pnpm exec tsc --noEmit
```

Expected: all pass. If a DB-backed host test fails because Postgres is unavailable, start the local database with the project's existing Docker Compose flow and rerun the same command.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: build completes. If build is blocked by a local service dependency, capture the exact error in the final report and keep the focused tests/typecheck as the verified safety net.

- [ ] **Step 4: Optional sandbox image smoke check**

Run only if Docker is available:

```bash
scripts/build-sandbox-image.sh
```

Expected: image builds with Python and OpenHands dependencies installed.

- [ ] **Step 5: Review changed files**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: no unexpected files. Changes should match the task ownership list.

- [ ] **Step 6: Commit verification fixes if any**

If verification required scoped fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix(openhands): stabilize runtime integration"
```

If no fixes were needed, do not create an empty commit.

---

## Acceptance Criteria

- `openhands` appears as a selectable runtime.
- OpenRouter model picker appears only for `openhands` and `vercel-ai`.
- Selecting a model persists into `SessionRuntimeState.modelId`.
- Browser sends selected `modelId` in `agent.prompt`.
- Broker accepts `runtime: "openhands"` and runs the OpenHands bridge.
- Bridge loads project skills, enables delegation, and emits JSONL mapped into `agent.*` events.
- OpenHands file edits appear through the existing file/preview refresh path.
- Existing Claude Code, Codex, and Vercel AI paths continue to pass their tests.
