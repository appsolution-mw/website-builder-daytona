import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

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

  const rows = await prisma.tokenUsage.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      turnId: true,
      label: true,
      durationMs: true,
      inputTokens: true,
      outputTokens: true,
      cacheCreationInputTokens: true,
      cacheReadInputTokens: true,
      totalTokens: true,
      webSearchRequests: true,
      webFetchRequests: true,
      costUsd: true,
      exitCode: true,
      serviceTier: true,
      inferenceGeo: true,
      rawUsage: true,
      modelUsage: true,
      createdAt: true,
    },
  });

  const usage = rows.map((row) => ({
    ...row,
    costUsd: Number(row.costUsd),
  }));
  const totals = usage.filter((row) => row.label === "TURN").reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheCreationInputTokens:
        acc.cacheCreationInputTokens + row.cacheCreationInputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + row.cacheReadInputTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      webSearchRequests: acc.webSearchRequests + row.webSearchRequests,
      webFetchRequests: acc.webFetchRequests + row.webFetchRequests,
      costUsd: acc.costUsd + row.costUsd,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      webSearchRequests: 0,
      webFetchRequests: 0,
      costUsd: 0,
    },
  );

  return NextResponse.json({ usage, totals });
}
