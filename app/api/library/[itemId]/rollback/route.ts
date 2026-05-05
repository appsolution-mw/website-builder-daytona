import { NextResponse } from "next/server";
import { rollbackLibraryItem } from "@/lib/library/service";
import { requireLibraryUser } from "../../_auth";

type ItemParams = {
  params: Promise<{ itemId: string }>;
};

function errorStatus(error: unknown): 404 | 409 {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("conflict") || message.includes("archived") ? 409 : 404;
}

export async function POST(request: Request, { params }: ItemParams): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    revisionId?: unknown;
    changeNote?: unknown;
  };

  if (typeof body.revisionId !== "string") {
    return NextResponse.json({ error: "revisionId is required" }, { status: 400 });
  }

  try {
    const revision = await rollbackLibraryItem({
      userId: currentUser.userId,
      itemId,
      revisionId: body.revisionId,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : "Rollback",
    });

    return NextResponse.json({ revision }, { status: 201 });
  } catch (error) {
    const status = errorStatus(error);
    return NextResponse.json(
      { error: status === 409 ? "rollback conflict" : "not found" },
      { status },
    );
  }
}
