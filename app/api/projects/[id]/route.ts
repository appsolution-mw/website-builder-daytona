import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
