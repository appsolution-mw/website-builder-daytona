import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export async function GET() {
  const projects = await prisma.project.findMany({
    where: { ownerId: DEV_USER_ID },
    orderBy: { lastActive: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      lastActive: true,
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name,
      ownerId: DEV_USER_ID,
      status: "RUNNING", // No Daytona yet; pretend it's always running.
    },
  });
  return NextResponse.json({ project }, { status: 201 });
}
