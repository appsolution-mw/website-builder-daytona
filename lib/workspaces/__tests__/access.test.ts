import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  ensureDefaultWorkspaceForUser,
  findAccessibleProject,
  requireAccessibleProject,
} from "@/lib/workspaces/access";

const testRunId = randomUUID();
const userIds = [
  `workspace-access-owner-${testRunId}`,
  `workspace-access-member-${testRunId}`,
  `workspace-access-outsider-${testRunId}`,
];
const userEmails = {
  owner: `workspace-access-owner-${testRunId}@example.com`,
  member: `workspace-access-member-${testRunId}@example.com`,
  outsider: `workspace-access-outsider-${testRunId}@example.com`,
};

async function cleanup(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { ownerId: { in: userIds } },
        { workspace: { members: { some: { userId: { in: userIds } } } } },
      ],
    },
    select: { id: true },
  });
  const projectIds = projects.map((project) => project.id);

  await prisma.message.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.session.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.workspace.deleteMany({
    where: { members: { some: { userId: { in: userIds } } } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createUser(
  key: keyof typeof userEmails,
  name?: string,
): Promise<{ id: string; email: string; name: string | null }> {
  const idByKey = {
    owner: userIds[0],
    member: userIds[1],
    outsider: userIds[2],
  } as const;

  return prisma.user.create({
    data: {
      id: idByKey[key],
      email: userEmails[key],
      name: name ?? "",
    },
    select: { id: true, email: true, name: true },
  });
}

describe("workspace access helpers", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates one default owner workspace per user", async () => {
    const owner = await createUser("owner", "  Ada Lovelace  ");

    const firstWorkspace = await ensureDefaultWorkspaceForUser(owner);
    const secondWorkspace = await ensureDefaultWorkspaceForUser(owner);

    expect(secondWorkspace).toEqual(firstWorkspace);
    expect(firstWorkspace.name).toBe("Ada Lovelace");

    const ownedWorkspaces = await prisma.workspace.findMany({
      where: {
        members: { some: { userId: owner.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    expect(ownedWorkspaces).toHaveLength(1);
  });

  it("creates one default owner workspace under concurrent first requests", async () => {
    const owner = await createUser("owner", "Grace Hopper");

    const [first, second] = await Promise.all([
      ensureDefaultWorkspaceForUser(owner),
      ensureDefaultWorkspaceForUser(owner),
    ]);

    expect(second.id).toBe(first.id);
    expect(await prisma.workspace.count({ where: { id: first.id } })).toBe(1);
    expect(await prisma.workspaceMember.count({
      where: { workspaceId: first.id, userId: owner.id, role: "OWNER" },
    })).toBe(1);
  });

  it("promotes existing default workspace membership to owner", async () => {
    const owner = await createUser("owner", "Katherine Johnson");
    const workspace = await prisma.workspace.create({
      data: { id: `default-${owner.id}`, name: "Existing workspace" },
      select: { id: true, name: true },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "MEMBER" },
    });

    const repairedWorkspace = await ensureDefaultWorkspaceForUser(owner);

    expect(repairedWorkspace).toEqual(workspace);
    await expect(prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
      select: { role: true },
    })).resolves.toEqual({ role: "OWNER" });
  });

  it("allows workspace members to access projects", async () => {
    const owner = await createUser("owner");
    const member = await createUser("member");
    const workspace = await ensureDefaultWorkspaceForUser(owner);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const project = await prisma.project.create({
      data: {
        name: "Workspace project",
        ownerId: owner.id,
        workspaceId: workspace.id,
      },
      select: { id: true, ownerId: true, workspaceId: true },
    });

    await expect(requireAccessibleProject({
      projectId: project.id,
      userId: member.id,
    })).resolves.toEqual(project);
  });

  it("does not allow non-members to access workspace projects", async () => {
    const owner = await createUser("owner");
    const outsider = await createUser("outsider");
    const workspace = await ensureDefaultWorkspaceForUser(owner);
    const project = await prisma.project.create({
      data: {
        name: "Private workspace project",
        ownerId: owner.id,
        workspaceId: workspace.id,
      },
      select: { id: true },
    });

    await expect(findAccessibleProject({
      projectId: project.id,
      userId: outsider.id,
    })).resolves.toBeNull();
    await expect(requireAccessibleProject({
      projectId: project.id,
      userId: outsider.id,
    })).rejects.toThrow("project_not_found");
  });
});
