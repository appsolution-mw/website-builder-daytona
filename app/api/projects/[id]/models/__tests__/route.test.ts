import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET } from "../route";

const DEV_USER_ID = "models-route-user";
const OTHER_USER_ID = "models-route-other";
const PROJECT_ID = "models-route-project";
const OTHER_PROJECT_ID = "models-route-other-project";
const MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools";

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
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env.DEV_USER_ID = DEV_USER_ID;
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
            architecture: { output_modalities: ["text"] },
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
        ],
      }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models`), {
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

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/models`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "OpenRouter models request failed: HTTP 502",
    });
  });
});
