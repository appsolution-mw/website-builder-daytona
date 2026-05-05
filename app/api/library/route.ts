import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createLibraryItem } from "@/lib/library/service";
import type { LibraryItemType } from "@/lib/library/types";
import { requireLibraryUser } from "./_auth";

const ITEM_TYPES = new Set<LibraryItemType>(["SKILL", "AGENT", "WORKFLOW_PRESET"]);

function isLibraryItemType(value: unknown): value is LibraryItemType {
  return typeof value === "string" && ITEM_TYPES.has(value as LibraryItemType);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const url = new URL(request.url);
  const rawType = url.searchParams.get("type");
  if (rawType !== null && !isLibraryItemType(rawType)) {
    return NextResponse.json({ error: "invalid library item type" }, { status: 400 });
  }

  const items = await prisma.libraryItem.findMany({
    where: {
      userId: currentUser.userId,
      ...(rawType ? { type: rawType } : {}),
    },
    include: { currentRevision: true },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
  });

  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const body = (await request.json().catch(() => ({}))) as {
    type?: unknown;
    slug?: unknown;
    name?: unknown;
    description?: unknown;
    tags?: unknown;
  };
  const type = isLibraryItemType(body.type) ? body.type : null;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!type || !slug || !name) {
    return NextResponse.json({ error: "type, slug, and name are required" }, { status: 400 });
  }

  try {
    const item = await createLibraryItem({
      userId: currentUser.userId,
      type,
      slug,
      name,
      description: typeof body.description === "string" ? body.description : "",
      tags: stringArray(body.tags),
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "library item already exists" }, { status: 409 });
    }
    throw error;
  }
}
