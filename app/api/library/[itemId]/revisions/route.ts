import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishLibraryRevision } from "@/lib/library/service";
import { requireLibraryUser } from "../../_auth";

type ItemParams = {
  params: Promise<{ itemId: string }>;
};

function errorStatus(error: unknown): 404 | 409 {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("conflict") || message.includes("archived") ? 409 : 404;
}

export async function GET(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, userId: currentUser.userId },
  });

  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const revisions = await prisma.libraryRevision.findMany({
    where: { itemId: item.id },
    orderBy: { version: "desc" },
  });

  return NextResponse.json({ revisions });
}

export async function POST(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    content?: unknown;
    configJson?: unknown;
    changeNote?: unknown;
  };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";

  if (!title || body.configJson === undefined) {
    return NextResponse.json({ error: "title and configJson are required" }, { status: 400 });
  }

  try {
    const revision = await publishLibraryRevision({
      userId: currentUser.userId,
      itemId,
      title,
      content,
      configJson: body.configJson as Prisma.InputJsonValue,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : "",
    });

    return NextResponse.json({ revision }, { status: 201 });
  } catch (error) {
    const status = errorStatus(error);
    return NextResponse.json(
      { error: status === 409 ? "revision publish conflict" : "not found" },
      { status },
    );
  }
}
