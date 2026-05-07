import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { fetchOpenRouterModels, type OpenRouterModelOption } from "@/lib/openrouter/models";

function normalizeConfiguredModelId(modelId: string): string {
  return modelId.startsWith("openrouter/") ? `openrouter:${modelId.slice("openrouter/".length)}` : modelId;
}

function isOpenRouterModelId(modelId: string): boolean {
  return modelId.startsWith("openrouter:");
}

function configuredOpenHandsModels(): OpenRouterModelOption[] {
  const rawModelId = process.env.OPENHANDS_MODEL?.trim();
  if (!rawModelId) return [];

  const modelId = normalizeConfiguredModelId(rawModelId);
  const modelName = modelId.split("/").at(-1) || modelId;
  return [
    {
      id: modelId,
      label: `Configured: ${modelName}`,
      contextLength: 0,
      promptPrice: null,
      completionPrice: null,
      supportedParameters: ["tools"],
      inputModalities: ["text", "image"],
    },
  ];
}

function mergeModels(
  configured: OpenRouterModelOption[],
  openRouter: OpenRouterModelOption[],
): OpenRouterModelOption[] {
  const openRouterIds = new Set(openRouter.map((model) => model.id));
  const verifiedConfigured = configured.filter(
    (model) => !isOpenRouterModelId(model.id) || openRouterIds.has(model.id),
  );
  const seen = new Set<string>();
  return [...verifiedConfigured, ...openRouter].filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const configuredModels = configuredOpenHandsModels();
  try {
    const openRouterModels = await fetchOpenRouterModels();
    return NextResponse.json({ models: mergeModels(configuredModels, openRouterModels) });
  } catch (error) {
    if (configuredModels.length > 0) {
      return NextResponse.json({ models: configuredModels });
    }

    const message = error instanceof Error ? error.message : "OpenRouter models request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
