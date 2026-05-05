import { prisma } from "@/lib/db/client";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export async function ensureDefaultWorkspaceForUser(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.workspace.findFirst({
    where: { members: { some: { userId: user.id, role: "OWNER" } } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.workspace.create({
    data: {
      name: user.name?.trim() || user.email || "My workspace",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    select: { id: true, name: true },
  });
}

export async function findAccessibleProject(input: {
  projectId: string;
  userId: string;
}): Promise<{ id: string; workspaceId: string | null; ownerId: string } | null> {
  return prisma.project.findFirst({
    where: {
      id: input.projectId,
      OR: [
        { ownerId: input.userId },
        { workspace: { members: { some: { userId: input.userId } } } },
      ],
    },
    select: { id: true, ownerId: true, workspaceId: true },
  });
}

export async function requireAccessibleProject(input: {
  projectId: string;
  userId: string;
}): Promise<{ id: string; workspaceId: string | null; ownerId: string }> {
  const project = await findAccessibleProject(input);
  if (!project) throw new Error("project_not_found");
  return project;
}
