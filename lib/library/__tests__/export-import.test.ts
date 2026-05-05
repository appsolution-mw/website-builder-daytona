import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { checksumPayload } from "../checksum";
import { exportLibrary, importLibrary } from "../export-import";
import { createLibraryItem, publishLibraryRevision } from "../service";

const userId = "library-export-user";
const sourceUserId = `${userId}-source`;

const skillConfig = {
  description: "",
  triggers: [],
  allowDynamicCommands: false,
} satisfies Prisma.InputJsonObject;

function revisionChecksum(input: { content: string; configJson: Prisma.InputJsonObject }): string {
  return checksumPayload({ content: input.content, configJson: input.configJson });
}

beforeEach(async (): Promise<void> => {
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryItem.updateMany({ data: { currentRevisionId: null } });
  await prisma.libraryRevision.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.user.deleteMany({ where: { id: { in: [userId, sourceUserId] } } });
  await prisma.user.create({ data: { id: userId, email: "library-export@example.com" } });
});

describe("library import/export", () => {
  it("exports current revisions sorted by type and slug with sorted tags", async (): Promise<void> => {
    const workflow = await createLibraryItem({
      userId,
      type: "WORKFLOW_PRESET",
      slug: "daily-build",
      name: "Daily Build",
      description: "",
      tags: ["zeta", "alpha"],
    });
    const agent = await createLibraryItem({
      userId,
      type: "AGENT",
      slug: "reviewer",
      name: "Reviewer",
      description: "",
      tags: [],
    });
    const b = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "b-skill",
      name: "B",
      description: "",
      tags: ["zeta", "alpha"],
    });
    const a = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "a-skill",
      name: "A",
      description: "",
      tags: [],
    });

    await publishLibraryRevision({
      userId,
      itemId: workflow.id,
      title: "Preset",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [],
        agents: [],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    await publishLibraryRevision({
      userId,
      itemId: agent.id,
      title: "Agent",
      content: "review",
      configJson: {
        delegationName: "reviewer",
        allowedTools: [],
        modelId: null,
        registration: "file-agent",
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    await publishLibraryRevision({
      userId,
      itemId: b.id,
      title: "B1",
      content: "b",
      configJson: skillConfig,
      changeNote: "",
    });
    await publishLibraryRevision({
      userId,
      itemId: a.id,
      title: "A1",
      content: "a",
      configJson: skillConfig,
      changeNote: "",
    });

    const exported = await exportLibrary({ userId, exportedAt: "2026-04-29T00:00:00.000Z" });

    expect(exported).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-04-29T00:00:00.000Z",
    });
    expect(exported.items.map((item) => `${item.type}:${item.slug}`)).toEqual([
      "SKILL:a-skill",
      "SKILL:b-skill",
      "AGENT:reviewer",
      "WORKFLOW_PRESET:daily-build",
    ]);
    expect(exported.items[1]?.tags).toEqual(["alpha", "zeta"]);
    expect(exported.items[0]?.currentRevision?.content).toBe("a");
    expect(Object.keys(exported.items[0] ?? {}).sort()).toEqual([
      "currentRevision",
      "description",
      "name",
      "revisions",
      "slug",
      "status",
      "tags",
      "type",
    ]);
  });

  it("imports changed content as a new revision", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "nextjs",
      name: "Next.js",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "v1",
      content: "old",
      configJson: skillConfig,
      changeNote: "",
    });

    const result = await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [
          {
            type: "SKILL",
            slug: "nextjs",
            name: "Next.js",
            description: "",
            tags: [],
            status: "PUBLISHED",
            currentRevision: {
              version: 1,
              title: "v2",
              content: "new",
              configJson: skillConfig,
              checksum: revisionChecksum({ content: "new", configJson: skillConfig }),
              changeNote: "import",
            },
          },
        ],
      },
    });

    expect(result).toEqual({ createdItems: 0, createdRevisions: 1, skippedRevisions: 0 });
    const revisions = await prisma.libraryRevision.findMany({
      where: { itemId: item.id },
      orderBy: { version: "asc" },
    });
    expect(revisions.map((revision) => revision.content)).toEqual(["old", "new"]);
  });

  it("creates missing items and skips an imported revision with an existing checksum", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "existing",
      name: "Existing",
      description: "",
      tags: [],
    });
    const existingRevision = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "v1",
      content: "same",
      configJson: skillConfig,
      changeNote: "",
    });
    await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "rollback duplicate",
      content: "same",
      configJson: skillConfig,
      changeNote: "same content is allowed",
    });

    const result = await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [
          {
            type: "SKILL",
            slug: "created",
            name: "Created",
            description: "Imported item",
            tags: ["imported"],
            status: "PUBLISHED",
            currentRevision: {
              version: 1,
              title: "Created v1",
              content: "created",
              configJson: skillConfig,
              checksum: revisionChecksum({ content: "created", configJson: skillConfig }),
              changeNote: "",
            },
          },
          {
            type: "SKILL",
            slug: "existing",
            name: "Existing",
            description: "",
            tags: [],
            status: "PUBLISHED",
            currentRevision: {
              version: existingRevision.version,
              title: existingRevision.title,
              content: existingRevision.content,
              configJson: skillConfig,
              checksum: existingRevision.checksum,
              changeNote: existingRevision.changeNote,
            },
          },
        ],
      },
    });

    expect(result).toEqual({ createdItems: 1, createdRevisions: 1, skippedRevisions: 1 });
    await expect(
      prisma.libraryItem.findUniqueOrThrow({
        where: { userId_type_slug: { userId, type: "SKILL", slug: "created" } },
      }),
    ).resolves.toMatchObject({
      name: "Created",
      description: "Imported item",
      tags: ["imported"],
      status: "PUBLISHED",
    });
    await expect(prisma.libraryRevision.count({ where: { itemId: item.id } })).resolves.toBe(2);
  });

  it("imports an older historical revision as current when current content differs", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "rollback-target",
      name: "Rollback Target",
      description: "",
      tags: [],
    });
    const older = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Older",
      content: "old",
      configJson: skillConfig,
      changeNote: "",
    });
    await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Current",
      content: "new",
      configJson: skillConfig,
      changeNote: "",
    });

    const result = await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [
          {
            type: "SKILL",
            slug: "rollback-target",
            name: "Rollback Target",
            description: "",
            tags: [],
            status: "PUBLISHED",
            currentRevision: {
              version: older.version,
              title: older.title,
              content: older.content,
              configJson: skillConfig,
              checksum: older.checksum,
              changeNote: older.changeNote,
            },
          },
        ],
      },
    });

    expect(result).toEqual({ createdItems: 0, createdRevisions: 1, skippedRevisions: 0 });
    const current = await prisma.libraryItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { currentRevision: true },
    });
    expect(current.currentRevision?.content).toBe("old");
    expect(current.currentRevision?.checksum).toBe(older.checksum);
    await expect(prisma.libraryRevision.count({ where: { itemId: item.id } })).resolves.toBe(3);
  });

  it("remaps workflow preset dependencies to imported target item and revision ids", async (): Promise<void> => {
    await prisma.user.create({
      data: { id: sourceUserId, email: "library-export-source@example.com" },
    });
    const skill = await createLibraryItem({
      userId: sourceUserId,
      type: "SKILL",
      slug: "source-skill",
      name: "Source Skill",
      description: "",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId: sourceUserId,
      itemId: skill.id,
      title: "Skill",
      content: "skill content",
      configJson: skillConfig,
      changeNote: "",
    });
    const agent = await createLibraryItem({
      userId: sourceUserId,
      type: "AGENT",
      slug: "source-agent",
      name: "Source Agent",
      description: "",
      tags: [],
    });
    const agentRevision = await publishLibraryRevision({
      userId: sourceUserId,
      itemId: agent.id,
      title: "Agent",
      content: "agent content",
      configJson: {
        delegationName: "source-agent",
        allowedTools: [],
        modelId: null,
        registration: "file-agent",
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    const preset = await createLibraryItem({
      userId: sourceUserId,
      type: "WORKFLOW_PRESET",
      slug: "source-preset",
      name: "Source Preset",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId: sourceUserId,
      itemId: preset.id,
      title: "Preset",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [{ itemId: skill.id, revisionId: skillRevision.id, enabled: true }],
        agents: [{ itemId: agent.id, revisionId: agentRevision.id, enabled: true }],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    const exported = await exportLibrary({
      userId: sourceUserId,
      exportedAt: "2026-04-29T00:00:00.000Z",
    });

    await importLibrary({ userId, file: exported });

    const targetSkill = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "SKILL", slug: "source-skill" } },
    });
    const targetAgent = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "AGENT", slug: "source-agent" } },
    });
    const targetPreset = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "WORKFLOW_PRESET", slug: "source-preset" } },
      include: { currentRevision: true },
    });
    const config = targetPreset.currentRevision?.configJson as {
      skills: Array<{ itemId: string; revisionId: string }>;
      agents: Array<{ itemId: string; revisionId: string }>;
    };

    expect(config.skills[0]?.itemId).toBe(targetSkill.id);
    expect(config.skills[0]?.revisionId).toBe(targetSkill.currentRevisionId);
    expect(config.agents[0]?.itemId).toBe(targetAgent.id);
    expect(config.agents[0]?.revisionId).toBe(targetAgent.currentRevisionId);
    expect(config.skills[0]?.itemId).not.toBe(skill.id);
    expect(config.agents[0]?.itemId).not.toBe(agent.id);
  });

  it("preserves workflow preset dependency revision pins during export and import", async (): Promise<void> => {
    await prisma.user.create({
      data: { id: sourceUserId, email: "library-export-source@example.com" },
    });
    const skill = await createLibraryItem({
      userId: sourceUserId,
      type: "SKILL",
      slug: "pinned-skill",
      name: "Pinned Skill",
      description: "",
      tags: [],
    });
    const olderSkillRevision = await publishLibraryRevision({
      userId: sourceUserId,
      itemId: skill.id,
      title: "Older Skill",
      content: "older skill content",
      configJson: skillConfig,
      changeNote: "",
    });
    const currentSkillRevision = await publishLibraryRevision({
      userId: sourceUserId,
      itemId: skill.id,
      title: "Current Skill",
      content: "current skill content",
      configJson: skillConfig,
      changeNote: "",
    });
    const preset = await createLibraryItem({
      userId: sourceUserId,
      type: "WORKFLOW_PRESET",
      slug: "pinned-preset",
      name: "Pinned Preset",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId: sourceUserId,
      itemId: preset.id,
      title: "Preset",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [{ itemId: skill.id, revisionId: olderSkillRevision.id, enabled: true }],
        agents: [],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });

    const exported = await exportLibrary({
      userId: sourceUserId,
      exportedAt: "2026-04-29T00:00:00.000Z",
    });
    const exportedSkill = exported.items.find((item) => item.slug === "pinned-skill");
    expect(exportedSkill?.revisions?.map((revision) => revision.sourceRevisionId)).toEqual([
      olderSkillRevision.id,
      currentSkillRevision.id,
    ]);

    await importLibrary({ userId, file: exported });

    const targetSkill = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "SKILL", slug: "pinned-skill" } },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    const targetPreset = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "WORKFLOW_PRESET", slug: "pinned-preset" } },
      include: { currentRevision: true },
    });
    const config = targetPreset.currentRevision?.configJson as {
      skills: Array<{ itemId: string; revisionId: string }>;
    };
    const pinnedTargetRevision = targetSkill.revisions.find(
      (revision) => revision.content === "older skill content",
    );

    expect(targetSkill.currentRevisionId).not.toBe(pinnedTargetRevision?.id);
    expect(config.skills[0]?.itemId).toBe(targetSkill.id);
    expect(config.skills[0]?.revisionId).toBe(pinnedTargetRevision?.id);
  });

  it("falls back to slug current revisions for legacy preset dependency revision ids", async (): Promise<void> => {
    const skillConfigJson = skillConfig;
    const legacySkillChecksum = revisionChecksum({
      content: "legacy skill content",
      configJson: skillConfigJson,
    });
    const legacyPresetConfig = {
      runtime: "openhands",
      modelId: null,
      skills: [
        {
          itemSlug: "legacy-skill",
          itemType: "SKILL",
          revisionId: "stale-legacy-source-revision",
          enabled: true,
        },
      ],
      agents: [],
      tools: [],
      remote: { mode: "local" },
    } satisfies Prisma.InputJsonObject;

    await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [
          {
            type: "SKILL",
            slug: "legacy-skill",
            name: "Legacy Skill",
            description: "",
            tags: [],
            status: "PUBLISHED",
            currentRevision: {
              version: 1,
              title: "Legacy Skill",
              content: "legacy skill content",
              configJson: skillConfigJson,
              checksum: legacySkillChecksum,
              changeNote: "",
            },
          },
          {
            type: "WORKFLOW_PRESET",
            slug: "legacy-preset",
            name: "Legacy Preset",
            description: "",
            tags: [],
            status: "PUBLISHED",
            currentRevision: {
              version: 1,
              title: "Legacy Preset",
              content: "",
              configJson: legacyPresetConfig,
              checksum: revisionChecksum({
                content: "",
                configJson: legacyPresetConfig,
              }),
              changeNote: "",
            },
          },
        ],
      },
    });

    const targetSkill = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "SKILL", slug: "legacy-skill" } },
    });
    const targetPreset = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "WORKFLOW_PRESET", slug: "legacy-preset" } },
      include: { currentRevision: true },
    });
    const config = targetPreset.currentRevision?.configJson as {
      skills: Array<{ itemId: string; revisionId: string }>;
    };

    expect(config.skills[0]?.itemId).toBe(targetSkill.id);
    expect(config.skills[0]?.revisionId).toBe(targetSkill.currentRevisionId);
    expect(config.skills[0]?.revisionId).not.toBe("stale-legacy-source-revision");
  });

  it("skips an already-current workflow preset revision when importing the same export twice", async (): Promise<void> => {
    await prisma.user.create({
      data: { id: sourceUserId, email: "library-export-source@example.com" },
    });
    const skill = await createLibraryItem({
      userId: sourceUserId,
      type: "SKILL",
      slug: "idempotent-skill",
      name: "Idempotent Skill",
      description: "",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId: sourceUserId,
      itemId: skill.id,
      title: "Skill",
      content: "skill content",
      configJson: skillConfig,
      changeNote: "",
    });
    const preset = await createLibraryItem({
      userId: sourceUserId,
      type: "WORKFLOW_PRESET",
      slug: "idempotent-preset",
      name: "Idempotent Preset",
      description: "",
      tags: [],
    });
    await publishLibraryRevision({
      userId: sourceUserId,
      itemId: preset.id,
      title: "Preset",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: null,
        skills: [
          {
            itemId: skill.id,
            revisionId: skillRevision.id,
            enabled: true,
            extraExportOnlyField: "removed during import",
          },
        ],
        agents: [],
        tools: [],
        remote: { mode: "local" },
      } satisfies Prisma.InputJsonObject,
      changeNote: "",
    });
    const exported = await exportLibrary({
      userId: sourceUserId,
      exportedAt: "2026-04-29T00:00:00.000Z",
    });

    await importLibrary({ userId, file: exported });
    const secondImport = await importLibrary({ userId, file: exported });

    const targetPreset = await prisma.libraryItem.findUniqueOrThrow({
      where: { userId_type_slug: { userId, type: "WORKFLOW_PRESET", slug: "idempotent-preset" } },
      include: { currentRevision: true },
    });
    const config = targetPreset.currentRevision?.configJson as {
      skills: Array<Record<string, unknown>>;
    };

    expect(secondImport).toEqual({ createdItems: 0, createdRevisions: 0, skippedRevisions: 2 });
    await expect(prisma.libraryRevision.count({ where: { itemId: targetPreset.id } })).resolves.toBe(1);
    expect(config.skills[0]).toEqual({
      itemId: expect.any(String),
      revisionId: expect.any(String),
      enabled: true,
    });
  });

  it("rejects imports with a mismatched current revision checksum", async (): Promise<void> => {
    await expect(
      importLibrary({
        userId,
        file: {
          schemaVersion: 1,
          exportedAt: "2026-04-29T00:00:00.000Z",
          items: [
            {
              type: "SKILL",
              slug: "bad-checksum",
              name: "Bad Checksum",
              description: "",
              tags: [],
              status: "PUBLISHED",
              currentRevision: {
                version: 1,
                title: "Bad",
                content: "content",
                configJson: skillConfig,
                checksum: "not-the-real-checksum",
                changeNote: "",
              },
            },
          ],
        },
      }),
    ).rejects.toThrow("imported revision checksum mismatch for SKILL:bad-checksum");
  });

  it("rolls back partial writes when a later import validation fails", async (): Promise<void> => {
    await expect(
      importLibrary({
        userId,
        file: {
          schemaVersion: 1,
          exportedAt: "2026-04-29T00:00:00.000Z",
          items: [
            {
              type: "SKILL",
              slug: "created-before-failure",
              name: "Created Before Failure",
              description: "",
              tags: [],
              status: "PUBLISHED",
              currentRevision: {
                version: 1,
                title: "Skill",
                content: "content",
                configJson: skillConfig,
                checksum: revisionChecksum({ content: "content", configJson: skillConfig }),
                changeNote: "",
              },
            },
            {
              type: "WORKFLOW_PRESET",
              slug: "missing-dependency",
              name: "Missing Dependency",
              description: "",
              tags: [],
              status: "PUBLISHED",
              currentRevision: {
                version: 1,
                title: "Preset",
                content: "",
                configJson: {
                  runtime: "openhands",
                  modelId: null,
                  skills: [
                    {
                      itemSlug: "does-not-exist",
                      revisionId: "missing-revision",
                      enabled: true,
                    },
                  ],
                  agents: [],
                  tools: [],
                  remote: { mode: "local" },
                } satisfies Prisma.InputJsonObject,
                checksum: revisionChecksum({
                  content: "",
                  configJson: {
                    runtime: "openhands",
                    modelId: null,
                    skills: [
                      {
                        itemSlug: "does-not-exist",
                        revisionId: "missing-revision",
                        enabled: true,
                      },
                    ],
                    agents: [],
                    tools: [],
                    remote: { mode: "local" },
                  } satisfies Prisma.InputJsonObject,
                }),
                changeNote: "",
              },
            },
          ],
        },
      }),
    ).rejects.toThrow("missing imported skill dependency for workflow preset");

    await expect(prisma.libraryItem.count({ where: { userId } })).resolves.toBe(0);
    await expect(prisma.libraryRevision.count()).resolves.toBe(0);
  });

  it("updates existing item metadata and status during import", async (): Promise<void> => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "metadata",
      name: "Old Name",
      description: "Old description",
      tags: ["old"],
    });
    await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "v1",
      content: "same",
      configJson: skillConfig,
      changeNote: "",
    });

    await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [
          {
            type: "SKILL",
            slug: "metadata",
            name: "New Name",
            description: "New description",
            tags: ["zeta", "alpha"],
            status: "ARCHIVED",
            currentRevision: {
              version: 1,
              title: "v1",
              content: "same",
              configJson: skillConfig,
              checksum: revisionChecksum({ content: "same", configJson: skillConfig }),
              changeNote: "",
            },
          },
        ],
      },
    });

    await expect(prisma.libraryItem.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({
      name: "New Name",
      description: "New description",
      tags: ["alpha", "zeta"],
      status: "ARCHIVED",
    });
  });
});
