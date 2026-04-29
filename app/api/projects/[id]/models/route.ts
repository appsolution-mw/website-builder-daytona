import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fetchOpenRouterModels, type OpenRouterModelOption } from "@/lib/openrouter/models";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

function configuredOpenHandsModels(): OpenRouterModelOption[] {
  const modelId = process.env.OPENHANDS_MODEL?.trim();
  if (!modelId) return [];

  const modelName = modelId.split("/").at(-1) || modelId;
  return [
    {
      id: modelId,
      label: `Configured: ${modelName}`,
      contextLength: 0,
      promptPrice: null,
      completionPrice: null,
      supportedParameters: ["tools"],
    },
  ];
}

function mergeModels(
  configured: OpenRouterModelOption[],
  openRouter: OpenRouterModelOption[],
): OpenRouterModelOption[] {
  const seen = new Set<string>();
  return [...configured, ...openRouter].filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: devUserId() },
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
