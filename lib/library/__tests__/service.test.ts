import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  createLibraryItem,
  createSessionLibrarySnapshot,
  publishLibraryRevision,
  resolveWorkflowPreset,
  rollbackLibraryItem,
} from "../service";

const userId = "library-service-user";
const otherUserId = "library-service-other-user";

const skillConfig = {
  description: "SEO skill",
  triggers: ["seo"],
  allowDynamicCommands: false,
} satisfies Prisma.InputJsonObject;

beforeEach(async (): Promise<void> => {
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.sessionRuntimeState.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.user.create({ data: { id: userId, email: "library-service@example.com" } });
});

describe("library service", () => {
  it("publishes immutable revisions and rolls back as a new revision", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "nextjs-seo",
      name: "Next.js SEO",
      description: "SEO skill",
      tags: ["nextjs"],
    });

    const first = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Initial",
      content: "v1",
      configJson: skillConfig,
      changeNote: "first",
    });
    const second = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Second",
      content: "v2",
      configJson: skillConfig,
      changeNote: "second",
    });
    const rollback = await rollbackLibraryItem({
      userId,
      itemId: item.id,
      revisionId: first.id,
      changeNote: "rollback to v1",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(rollback.version).toBe(3);
    expect(rollback.content).toBe("v1");
    expect(rollback.configJson).toEqual(first.configJson);
    expect(rollback.checksum).toBe(first.checksum);

    const current = await prisma.libraryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(current.currentRevisionId).toBe(rollback.id);

    const revisions = await prisma.libraryRevision.findMany({
      where: { itemId: item.id },
      orderBy: { version: "asc" },
    });
    expect(revisions.map((revision) => revision.id)).toEqual([first.id, second.id, rollback.id]);
  });

  it("uses content and config only for revision checksums", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "checksum-skill",
      name: "Checksum Skill",
      description: "",
      tags: [],
    });
    const first = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Initial",
      content: "same",
      configJson: skillConfig,
      changeNote: "first",
    });

    const second = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Metadata changed",
      content: "same",
      configJson: skillConfig,
      changeNote: "different metadata",
    });

    const revisions = await prisma.libraryRevision.findMany({ where: { itemId: item.id } });
    expect(revisions).toHaveLength(2);
    expect(second.checksum).toBe(first.checksum);
  });

  it("resolves presets into fully materialized snapshots", async (): Promise<void> => {
    const skill = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "nextjs-seo",
      name: "Next.js SEO",
      description: "SEO skill",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId,
      itemId: skill.id,
      title: "Skill v1",
      content: "Use metadata.",
      configJson: skillConfig,
      changeNote: "",
    });
    const agent = await createLibraryItem({
      userId,
      type: "AGENT",
      slug: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      tags: [],
    });
    const agentRevision = await publishLibraryRevision({
      userId,
      itemId: agent.id,
      title: "Agent v1",
      content: "Review for correctness.",
      configJson: {
        delegationName: "reviewer",
        allowedTools: ["Read"],
        modelId: "openrouter:anthropic/claude-sonnet-4.5",
        registration: "file-agent",
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    const preset = await createLibraryItem({
      userId,
      type: "WORKFLOW_PRESET",
      slug: "next-builder",
      name: "Next Builder",
      description: "Build Next.js apps",
      tags: [],
    });
    const presetRevision = await publishLibraryRevision({
      userId,
      itemId: preset.id,
      title: "Preset v1",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: "openrouter:qwen/qwen3-coder:free",
        skills: [{ itemId: skill.id, revisionId: skillRevision.id, enabled: true }],
        agents: [{ itemId: agent.id, revisionId: agentRevision.id, enabled: true }],
        tools: ["TerminalTool", "FileEditorTool"],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });

    const resolved = await resolveWorkflowPreset({ userId, presetItemId: preset.id });

    expect(resolved.preset.revisionId).toBe(presetRevision.id);
    expect(resolved).toMatchObject({
      runtime: "openhands",
      modelId: "openrouter:qwen/qwen3-coder:free",
      tools: ["TerminalTool", "FileEditorTool"],
      remote: { mode: "local" },
    });
    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]).toMatchObject({
      itemId: skill.id,
      revisionId: skillRevision.id,
      content: "Use metadata.",
      config: skillConfig,
    });
    expect(resolved.agents).toHaveLength(1);
    expect(resolved.agents[0]).toMatchObject({
      itemId: agent.id,
      revisionId: agentRevision.id,
      content: "Review for correctness.",
      config: {
        delegationName: "reviewer",
        allowedTools: ["Read"],
        modelId: "openrouter:anthropic/claude-sonnet-4.5",
        registration: "file-agent",
      },
    });
  });

  it("rejects preset entries whose itemId does not match the revision owner", async (): Promise<void> => {
    const skill = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "matched-skill",
      name: "Matched Skill",
      description: "",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId,
      itemId: skill.id,
      title: "Skill v1",
      content: "Use me.",
      configJson: skillConfig,
      changeNote: "",
    });
    const otherSkill = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "other-skill",
      name: "Other Skill",
      description: "",
      tags: [],
    });
    const preset = await createLibraryItem({
      userId,
      type: "WORKFLOW_PRESET",
      slug: "mismatched-preset",
      name: "Mismatched Preset",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId,
      itemId: preset.id,
      title: "Preset v1",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [{ itemId: otherSkill.id, revisionId: skillRevision.id, enabled: true }],
        agents: [],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });

    await expect(resolveWorkflowPreset({ userId, presetItemId: preset.id })).rejects.toThrow(
      `skill revision ${skillRevision.id} does not belong to item ${otherSkill.id}`,
    );
  });

  it("does not resolve archived items for new presets", async (): Promise<void> => {
    const skill = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "archived-skill",
      name: "Archived Skill",
      description: "",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId,
      itemId: skill.id,
      title: "Skill v1",
      content: "Do not use.",
      configJson: skillConfig,
      changeNote: "",
    });
    await prisma.libraryItem.update({ where: { id: skill.id }, data: { status: "ARCHIVED" } });

    const preset = await createLibraryItem({
      userId,
      type: "WORKFLOW_PRESET",
      slug: "archived-skill-preset",
      name: "Archived Skill Preset",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId,
      itemId: preset.id,
      title: "Preset v1",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [{ itemId: skill.id, revisionId: skillRevision.id, enabled: true }],
        agents: [],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });

    await expect(resolveWorkflowPreset({ userId, presetItemId: preset.id })).rejects.toThrow(
      `missing skill revision ${skillRevision.id}`,
    );
  });

  it("rejects publish and rollback for archived items", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "archived-publish-skill",
      name: "Archived Publish Skill",
      description: "",
      tags: [],
    });
    const revision = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Skill v1",
      content: "Published before archival.",
      configJson: skillConfig,
      changeNote: "",
    });
    await prisma.libraryItem.update({ where: { id: item.id }, data: { status: "ARCHIVED" } });

    await expect(
      publishLibraryRevision({
        userId,
        itemId: item.id,
        title: "Skill v2",
        content: "Do not publish.",
        configJson: skillConfig,
        changeNote: "",
      }),
    ).rejects.toThrow("archived library items cannot be published");
    await expect(
      rollbackLibraryItem({
        userId,
        itemId: item.id,
        revisionId: revision.id,
        changeNote: "Do not rollback",
      }),
    ).rejects.toThrow("archived library items cannot be rolled back");
  });

  it("stores session snapshots with resolved content", async (): Promise<void> => {
    const project = await prisma.project.create({
      data: {
        ownerId: userId,
        name: "Project",
        status: "RUNNING",
        sessions: { create: { title: "Main chat", defaultRuntime: "OPENHANDS" } },
      },
      include: { sessions: true },
    });
    const session = project.sessions[0];
    const runtimeState = await prisma.sessionRuntimeState.create({
      data: {
        projectId: project.id,
        sessionId: session.id,
        runtime: "OPENHANDS",
        providerSessionId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const snapshot = await createSessionLibrarySnapshot({
      userId,
      projectId: project.id,
      sessionId: session.id,
      sessionRuntimeStateId: runtimeState.id,
      payload: {
        schemaVersion: 1,
        preset: { itemId: null, revisionId: null, slug: null, name: null },
        runtime: "openhands",
        modelId: null,
        tools: ["TerminalTool"],
        remote: { mode: "local" },
        skills: [],
        agents: [],
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    });

    expect(snapshot.snapshotJson).toMatchObject({ schemaVersion: 1, tools: ["TerminalTool"] });
  });

  it("rejects session snapshots outside the user's project/session/runtime state", async (): Promise<void> => {
    await prisma.user.create({
      data: { id: otherUserId, email: "library-service-other@example.com" },
    });
    const project = await prisma.project.create({
      data: {
        ownerId: userId,
        name: "Project",
        status: "RUNNING",
        sessions: { create: { title: "Main chat", defaultRuntime: "OPENHANDS" } },
      },
      include: { sessions: true },
    });
    const session = project.sessions[0];
    const runtimeState = await prisma.sessionRuntimeState.create({
      data: {
        projectId: project.id,
        sessionId: session.id,
        runtime: "OPENHANDS",
        providerSessionId: "22222222-2222-4222-8222-222222222222",
      },
    });
    const payload = {
      schemaVersion: 1,
      preset: { itemId: null, revisionId: null, slug: null, name: null },
      runtime: "openhands",
      modelId: null,
      tools: ["TerminalTool"],
      remote: { mode: "local" },
      skills: [],
      agents: [],
      createdAt: "2026-04-29T00:00:00.000Z",
    } satisfies Parameters<typeof createSessionLibrarySnapshot>[0]["payload"];

    await expect(
      createSessionLibrarySnapshot({
        userId: otherUserId,
        projectId: project.id,
        sessionId: session.id,
        sessionRuntimeStateId: runtimeState.id,
        payload,
      }),
    ).rejects.toThrow("project not found for user");

    const otherProject = await prisma.project.create({
      data: {
        ownerId: userId,
        name: "Other Project",
        status: "RUNNING",
        sessions: { create: { title: "Other chat", defaultRuntime: "OPENHANDS" } },
      },
      include: { sessions: true },
    });

    await expect(
      createSessionLibrarySnapshot({
        userId,
        projectId: otherProject.id,
        sessionId: session.id,
        sessionRuntimeStateId: runtimeState.id,
        payload,
      }),
    ).rejects.toThrow("session not found for project");

    const otherSession = otherProject.sessions[0];
    const otherRuntimeState = await prisma.sessionRuntimeState.create({
      data: {
        projectId: otherProject.id,
        sessionId: otherSession.id,
        runtime: "OPENHANDS",
        providerSessionId: "33333333-3333-4333-8333-333333333333",
      },
    });

    await expect(
      createSessionLibrarySnapshot({
        userId,
        projectId: project.id,
        sessionId: session.id,
        sessionRuntimeStateId: otherRuntimeState.id,
        payload,
      }),
    ).rejects.toThrow("session runtime state not found for project session");
  });
});
