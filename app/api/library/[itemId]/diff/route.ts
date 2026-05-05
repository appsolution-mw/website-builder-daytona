import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { stableStringify } from "@/lib/library/checksum";
import { requireLibraryUser } from "../../_auth";

type ItemParams = {
  params: Promise<{ itemId: string }>;
};

export async function GET(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const url = new URL(request.url);
  const fromRevisionId = url.searchParams.get("fromRevisionId");
  const toRevisionId = url.searchParams.get("toRevisionId");

  if (!fromRevisionId || !toRevisionId) {
    return NextResponse.json(
      { error: "fromRevisionId and toRevisionId are required" },
      { status: 400 },
    );
  }

  const revisions = await prisma.libraryRevision.findMany({
    where: {
      itemId,
      id: { in: [fromRevisionId, toRevisionId] },
      item: { userId: currentUser.userId },
    },
  });
  const from = revisions.find((revision) => revision.id === fromRevisionId);
  const to = revisions.find((revision) => revision.id === toRevisionId);

  if (!from || !to) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    from: {
      id: from.id,
      version: from.version,
      contentLines: from.content.split("\n"),
    },
    to: {
      id: to.id,
      version: to.version,
      contentLines: to.content.split("\n"),
    },
    configChanged: stableStringify(from.configJson) !== stableStringify(to.configJson),
  });
}
