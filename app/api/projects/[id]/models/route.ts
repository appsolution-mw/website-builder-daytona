import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fetchOpenRouterModels } from "@/lib/openrouter/models";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
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

  try {
    const models = await fetchOpenRouterModels();
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter models request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
