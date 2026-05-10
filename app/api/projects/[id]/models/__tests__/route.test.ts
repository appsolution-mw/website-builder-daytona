import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET } from "../route";

const DEV_USER_ID = "models-route-user";
const OTHER_USER_ID = "models-route-other";
const PROJECT_ID = "models-route-project";
const OTHER_PROJECT_ID = "models-route-other-project";
const MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools";

const originalDevUserId = process.env.DEV_USER_ID;
const originalOpenHandsModel = process.env.OPENHANDS_MODEL;
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  const projectIds = [PROJECT_ID, OTHER_PROJECT_ID];
  await prisma.message.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.session.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [DEV_USER_ID, OTHER_USER_ID] } } });
}

describe("GET /api/projects/[id]/models", () => {
  afterAll(() => {
    if (originalDevUserId === undefined) {
      delete process.env.DEV_USER_ID;
    } else {
      process.env.DEV_USER_ID = originalDevUserId;
    }

    if (originalOpenHandsModel === undefined) {
      delete process.env.OPENHANDS_MODEL;
    } else {
      process.env.OPENHANDS_MODEL = originalOpenHandsModel;
    }

    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.DEV_USER_ID = DEV_USER_ID;
    delete process.env.OPENHANDS_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    await cleanDatabase();
    await prisma.user.create({
      data: { id: DEV_USER_ID, email: "models-route-user@example.com" },
    });
    await prisma.user.create({
      data: { id: OTHER_USER_ID, email: "models-route-other@example.com" },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanDatabase();
  });

  it("returns 404 for a missing project", async () => {
    const res = await GET(new Request("http://localhost/api/projects/missing/models"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's project", async () => {
    await prisma.project.create({
      data: {
        id: OTHER_PROJECT_ID,
        ownerId: OTHER_USER_ID,
        name: "Models Route Other Project",
      },
    });

    const res = await GET(new Request(`http://localhost/api/projects/${OTHER_PROJECT_ID}/models`), {
      params: Promise.resolve({ id: OTHER_PROJECT_ID }),
    });

    expect(res.status).toBe(404);
  });

  it("returns normalized OpenRouter models for the project owner", async () => {
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        data: [
          {
            id: "qwen/qwen3-coder:free",
            name: "Qwen Coder",
            context_length: 1048576,
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
        ],
      }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=openhands`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(MODELS_URL, { cache: "no-store" });
    await expect(res.json()).resolves.toEqual({
      models: [
        {
          id: "openrouter:qwen/qwen3-coder:free",
          label: "Qwen Coder",
          contextLength: 1048576,
          promptPrice: "0",
          completionPrice: "0",
          supportedParameters: ["tools"],
          inputModalities: ["text", "image"],
        },
      ],
    });
  });

  it("prepends configured OpenHands model from env", async () => {
    process.env.OPENHANDS_MODEL = "openai/qwen3.6-max-preview";
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=openhands`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      models: [
        {
          id: "openai/qwen3.6-max-preview",
          label: "Configured: qwen3.6-max-preview",
          contextLength: 0,
          promptPrice: null,
          completionPrice: null,
          supportedParameters: ["tools"],
          inputModalities: ["text", "image"],
        },
      ],
    });
  });

  it("does not prepend unavailable configured OpenRouter models", async () => {
    process.env.OPENHANDS_MODEL = "openrouter:moonshotai/kimi-k2.6";
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        data: [
          {
            id: "qwen/qwen3-coder:free",
            name: "Qwen Coder",
            context_length: 1048576,
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
        ],
      }),
      { status: 200 },
    )));

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=openhands`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      models: [
        {
          id: "openrouter:qwen/qwen3-coder:free",
          label: "Qwen Coder",
          contextLength: 1048576,
          promptPrice: "0",
          completionPrice: "0",
          supportedParameters: ["tools"],
          inputModalities: ["text", "image"],
        },
      ],
    });
  });

  it("returns configured OpenHands model when OpenRouter fetch fails", async () => {
    process.env.OPENHANDS_MODEL = "openai/qwen3.6-max-preview";
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=openhands`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      models: [
        {
          id: "openai/qwen3.6-max-preview",
          label: "Configured: qwen3.6-max-preview",
          contextLength: 0,
          promptPrice: null,
          completionPrice: null,
          supportedParameters: ["tools"],
          inputModalities: ["text", "image"],
        },
      ],
    });
  });

  it("returns 502 when OpenRouter fetch fails", async () => {
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=openhands`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "OpenRouter models request failed: HTTP 502",
    });
  });

  it("fetches Claude models from the Anthropic API and adds [1m] variants", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      expect(target.startsWith("https://api.anthropic.com/v1/models")).toBe(true);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["x-api-key"]).toBe("sk-ant-test");
      expect(headers?.["anthropic-version"]).toBe("2023-06-01");
      return new Response(
        JSON.stringify({
          data: [
            {
              type: "model",
              id: "claude-opus-4-7-20251101",
              display_name: "Claude Opus 4.7",
              created_at: "2025-11-01T00:00:00Z",
            },
            {
              type: "model",
              id: "claude-haiku-4-5-20251001",
              display_name: "Claude Haiku 4.5",
              created_at: "2025-10-01T00:00:00Z",
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=claude-code`),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { id: string; contextLength: number }[] };
    const ids = body.models.map((m) => m.id);
    expect(ids).toContain("claude-opus-4-7-20251101[1m]");
    expect(ids).toContain("claude-opus-4-7-20251101");
    expect(ids).toContain("claude-haiku-4-5-20251001");
    expect(ids).not.toContain("claude-haiku-4-5-20251001[1m]");
    const oneMVariant = body.models.find((m) => m.id === "claude-opus-4-7-20251101[1m]");
    expect(oneMVariant?.contextLength).toBe(1_000_000);
  });

  it("returns 502 when ANTHROPIC_API_KEY is unset for runtime=claude-code", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=claude-code`),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "ANTHROPIC_API_KEY is not configured",
    });
  });

  it("returns 502 when the Anthropic models request fails", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=claude-code`),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Anthropic models request failed: HTTP 403",
    });
  });

  it("rejects requests with no or unsupported runtime", async () => {
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        ownerId: DEV_USER_ID,
        name: "Models Route Project",
      },
    });

    const noRuntime = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/models`),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );
    expect(noRuntime.status).toBe(400);

    const bogus = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/models?runtime=mystery`),
      { params: Promise.resolve({ id: PROJECT_ID }) },
    );
    expect(bogus.status).toBe(400);
  });
});
