import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireLibraryUser } from "../../../_auth";

type RevisionParams = {
  params: Promise<{ itemId: string; revisionId: string }>;
};

export async function GET(
  request: Request,
  { params }: RevisionParams,
): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId, revisionId } = await params;
  const revision = await prisma.libraryRevision.findFirst({
    where: {
      id: revisionId,
      itemId,
      item: { userId: currentUser.userId },
    },
  });

  if (!revision) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ revision });
}
