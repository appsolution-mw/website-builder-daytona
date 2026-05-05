import { prisma } from "@/lib/db/client";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export async function ensureDefaultWorkspaceForUser(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<{ id: string; name: string }> {
  const defaultWorkspaceId = `default-${user.id}`;
  const defaultWorkspaceName = user.name?.trim() || user.email || "My workspace";
  const existing = await prisma.workspace.findFirst({
    where: { members: { some: { userId: user.id, role: "OWNER" } } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const workspace = await prisma.workspace.upsert({
    where: { id: defaultWorkspaceId },
    create: {
      id: defaultWorkspaceId,
      name: defaultWorkspaceName,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    update: {},
    select: { id: true, name: true },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  return workspace;
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
