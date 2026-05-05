import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import type { LibraryItemStatus } from "@/lib/library/types";
import { requireLibraryUser } from "../_auth";

type ItemParams = {
  params: Promise<{ itemId: string }>;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isSupportedStatus(value: unknown): value is LibraryItemStatus {
  return value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED";
}

export async function GET(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, userId: currentUser.userId },
    include: {
      currentRevision: true,
      revisions: { orderBy: { version: "desc" } },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}

export async function PATCH(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    status?: unknown;
  };
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, userId: currentUser.userId },
  });

  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (body.status !== undefined && !isSupportedStatus(body.status)) {
    return NextResponse.json({ error: "invalid library item status" }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== "ARCHIVED") {
    return NextResponse.json({ error: "invalid library item status transition" }, { status: 409 });
  }

  const updated = await prisma.libraryItem.update({
    where: { id: item.id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(Array.isArray(body.tags) ? { tags: stringArray(body.tags) } : {}),
      ...(body.status === "ARCHIVED" ? { status: body.status } : {}),
    },
  });

  return NextResponse.json({ item: updated });
}
