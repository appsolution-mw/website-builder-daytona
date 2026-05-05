import type {
  LibraryItem,
  LibraryRevision,
  Prisma,
  SessionLibrarySnapshot,
} from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { checksumPayload } from "./checksum";
import type {
  LibraryAgentConfig,
  LibraryItemType,
  LibrarySkillConfig,
  SessionLibrarySnapshotPayload,
  WorkflowPresetConfig,
} from "./types";

type LibraryRevisionWithItem = LibraryRevision & { item: LibraryItem };
type LibraryTransaction = Prisma.TransactionClient;

function hasStringProperty(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return hasStringProperty(error, "code") && error.code === "P2002";
}

function uniqueConstraintTarget(error: unknown): string[] {
  if (!hasStringProperty(error, "meta")) return [];
  const meta = error.meta;
  if (typeof meta !== "object" || meta === null || !("target" in meta)) return [];
  const target = meta.target;
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === "string");
  }
  return typeof target === "string" ? [target] : [];
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringsFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asSkillConfig(value: unknown): LibrarySkillConfig {
  const obj = assertObject(value, "skill config");
  return {
    description: typeof obj.description === "string" ? obj.description : "",
    triggers: stringsFromArray(obj.triggers),
    allowDynamicCommands: obj.allowDynamicCommands === true,
  };
}

function asAgentConfig(value: unknown): LibraryAgentConfig {
  const obj = assertObject(value, "agent config");
  return {
    delegationName: typeof obj.delegationName === "string" ? obj.delegationName : "",
    allowedTools: stringsFromArray(obj.allowedTools),
    modelId: typeof obj.modelId === "string" ? obj.modelId : null,
    registration: obj.registration === "file-agent" ? "file-agent" : "skill-fallback",
  };
}

function asPresetEntry(value: unknown, label: string): {
  itemId: string;
  revisionId: string;
  enabled: boolean;
} | null {
  const entry = assertObject(value, label);
  if (typeof entry.itemId !== "string" || typeof entry.revisionId !== "string") {
    return null;
  }
  return {
    itemId: entry.itemId,
    revisionId: entry.revisionId,
    enabled: entry.enabled !== false,
  };
}

function asPresetEntries(value: unknown, label: string): Array<{
  itemId: string;
  revisionId: string;
  enabled: boolean;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = asPresetEntry(item, label);
    return entry ? [entry] : [];
  });
}

function asPresetConfig(value: unknown): WorkflowPresetConfig {
  const obj = assertObject(value, "preset config");
  const remote = assertObject(obj.remote ?? { mode: "local" }, "preset remote");
  const mode = remote.mode;

  return {
    runtime: obj.runtime === "openhands" ? "openhands" : "openhands",
    modelId: typeof obj.modelId === "string" ? obj.modelId : null,
    skills: asPresetEntries(obj.skills, "preset skill"),
    agents: asPresetEntries(obj.agents, "preset agent"),
    tools: stringsFromArray(obj.tools),
    remote: {
      mode: mode === "docker" || mode === "api" || mode === "cloud" ? mode : "local",
    },
  };
}

function configForType(type: LibraryItemType, configJson: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (type === "SKILL") return asSkillConfig(configJson) as Prisma.InputJsonObject;
  if (type === "AGENT") return asAgentConfig(configJson) as Prisma.InputJsonObject;
  return asPresetConfig(configJson) as unknown as Prisma.InputJsonObject;
}

function revisionChecksum(input: {
  content: string;
  configJson: Prisma.InputJsonValue;
}): string {
  return checksumPayload({
    content: input.content,
    configJson: input.configJson,
  });
}

function revisionConflictError(error: unknown): Error {
  if (!isPrismaUniqueConstraintError(error)) {
    return error instanceof Error ? error : new Error("library revision publish failed");
  }
  const target = uniqueConstraintTarget(error);
  if (target.includes("version")) {
    return new Error("concurrent publish conflict");
  }
  return new Error("library revision unique constraint conflict");
}

export async function createLibraryItem(input: {
  userId: string;
  type: LibraryItemType;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  tx?: LibraryTransaction;
}): Promise<LibraryItem> {
  const db = input.tx ?? prisma;
  return db.libraryItem.create({
    data: {
      userId: input.userId,
      type: input.type,
      slug: input.slug,
      name: input.name,
      description: input.description,
      tags: input.tags,
    },
  });
}

export async function publishLibraryRevision(input: {
  userId: string;
  itemId: string;
  title: string;
  content: string;
  configJson: Prisma.InputJsonValue;
  changeNote: string;
  tx?: LibraryTransaction;
}): Promise<LibraryRevision> {
  const publish = async (tx: LibraryTransaction): Promise<LibraryRevision> => {
    const item = await tx.libraryItem.findFirstOrThrow({
      where: { id: input.itemId, userId: input.userId },
    });
    if (item.status === "ARCHIVED") {
      throw new Error("archived library items cannot be published");
    }

    const latest = await tx.libraryRevision.findFirst({
      where: { itemId: item.id },
      select: { version: true },
      orderBy: { version: "desc" },
    });
    const version = (latest?.version ?? 0) + 1;
    const configJson = configForType(item.type, input.configJson);
    const checksum = revisionChecksum({
      content: input.content,
      configJson,
    });
    const revision = await tx.libraryRevision.create({
      data: {
        itemId: item.id,
        version,
        title: input.title,
        content: input.content,
        configJson,
        checksum,
        createdBy: input.userId,
        changeNote: input.changeNote,
      },
    });

    await tx.libraryItem.update({
      where: { id: item.id },
      data: { currentRevisionId: revision.id, status: "PUBLISHED" },
    });

    return revision;
  };

  try {
    return input.tx ? await publish(input.tx) : await prisma.$transaction(publish);
  } catch (error) {
    throw revisionConflictError(error);
  }
}

export async function rollbackLibraryItem(input: {
  userId: string;
  itemId: string;
  revisionId: string;
  changeNote: string;
}): Promise<LibraryRevision> {
  const revision = await prisma.libraryRevision.findFirstOrThrow({
    where: { id: input.revisionId, item: { id: input.itemId, userId: input.userId } },
    include: { item: true },
  });
  if (revision.item.status === "ARCHIVED") {
    throw new Error("archived library items cannot be rolled back");
  }
  const configJson = assertObject(revision.configJson, "revision config") as Prisma.InputJsonObject;

  return publishLibraryRevision({
    userId: input.userId,
    itemId: input.itemId,
    title: `Rollback to v${revision.version}`,
    content: revision.content,
    configJson,
    changeNote: input.changeNote,
  });
}

function getResolvedRevision(input: {
  revisionsById: Map<string, LibraryRevisionWithItem>;
  entryItemId: string;
  entryRevisionId: string;
  expectedType: LibraryItemType;
  label: "skill" | "agent";
}): LibraryRevisionWithItem {
  const revision = input.revisionsById.get(input.entryRevisionId);
  if (!revision || revision.item.type !== input.expectedType) {
    throw new Error(`missing ${input.label} revision ${input.entryRevisionId}`);
  }
  if (revision.itemId !== input.entryItemId) {
    throw new Error(
      `${input.label} revision ${input.entryRevisionId} does not belong to item ${input.entryItemId}`,
    );
  }
  return revision;
}

export async function resolveWorkflowPreset(input: {
  userId: string;
  presetItemId: string;
  presetRevisionId?: string;
}): Promise<SessionLibrarySnapshotPayload> {
  const preset = await prisma.libraryItem.findFirstOrThrow({
    where: {
      id: input.presetItemId,
      userId: input.userId,
      type: "WORKFLOW_PRESET",
      status: { not: "ARCHIVED" },
    },
  });
  const presetRevision = input.presetRevisionId
    ? await prisma.libraryRevision.findFirstOrThrow({
        where: { id: input.presetRevisionId, itemId: preset.id },
      })
    : await prisma.libraryRevision.findFirstOrThrow({
        where: { id: preset.currentRevisionId ?? "" },
      });
  const config = asPresetConfig(presetRevision.configJson);
  const skillEntries = config.skills.filter((entry) => entry.enabled);
  const agentEntries = config.agents.filter((entry) => entry.enabled);
  const revisionIds = [...skillEntries, ...agentEntries].map((entry) => entry.revisionId);
  const revisions = await prisma.libraryRevision.findMany({
    where: {
      id: { in: revisionIds },
      item: { userId: input.userId, status: { not: "ARCHIVED" } },
    },
    include: { item: true },
  });
  const revisionsById = new Map<string, LibraryRevisionWithItem>(
    revisions.map((revision) => [revision.id, revision]),
  );

  return {
    schemaVersion: 1,
    preset: {
      itemId: preset.id,
      revisionId: presetRevision.id,
      slug: preset.slug,
      name: preset.name,
    },
    runtime: config.runtime,
    modelId: config.modelId,
    tools: config.tools,
    remote: config.remote,
    skills: skillEntries.map((entry) => {
      const revision = getResolvedRevision({
        revisionsById,
        entryItemId: entry.itemId,
        entryRevisionId: entry.revisionId,
        expectedType: "SKILL",
        label: "skill",
      });
      return {
        itemId: revision.itemId,
        revisionId: revision.id,
        slug: revision.item.slug,
        name: revision.item.name,
        content: revision.content,
        config: asSkillConfig(revision.configJson),
      };
    }),
    agents: agentEntries.map((entry) => {
      const revision = getResolvedRevision({
        revisionsById,
        entryItemId: entry.itemId,
        entryRevisionId: entry.revisionId,
        expectedType: "AGENT",
        label: "agent",
      });
      return {
        itemId: revision.itemId,
        revisionId: revision.id,
        slug: revision.item.slug,
        name: revision.item.name,
        content: revision.content,
        config: asAgentConfig(revision.configJson),
      };
    }),
    createdAt: new Date().toISOString(),
  };
}

export async function createSessionLibrarySnapshot(input: {
  userId: string;
  projectId: string;
  sessionId: string;
  sessionRuntimeStateId: string;
  presetItemId?: string | null;
  presetRevisionId?: string | null;
  payload: SessionLibrarySnapshotPayload;
  tx?: LibraryTransaction;
}): Promise<SessionLibrarySnapshot> {
  const db = input.tx ?? prisma;

  await db.project.findFirstOrThrow({
    where: {
      id: input.projectId,
      OR: [
        { ownerId: input.userId },
        { workspace: { members: { some: { userId: input.userId } } } },
      ],
    },
  }).catch(() => {
    throw new Error("project not found for user");
  });
  await db.session.findFirstOrThrow({
    where: { id: input.sessionId, projectId: input.projectId },
  }).catch(() => {
    throw new Error("session not found for project");
  });
  await db.sessionRuntimeState.findFirstOrThrow({
    where: {
      id: input.sessionRuntimeStateId,
      projectId: input.projectId,
      sessionId: input.sessionId,
    },
  }).catch(() => {
    throw new Error("session runtime state not found for project session");
  });

  return db.sessionLibrarySnapshot.create({
    data: {
      projectId: input.projectId,
      sessionId: input.sessionId,
      sessionRuntimeStateId: input.sessionRuntimeStateId,
      presetItemId: input.presetItemId ?? input.payload.preset.itemId,
      presetRevisionId: input.presetRevisionId ?? input.payload.preset.revisionId,
      snapshotJson: input.payload as unknown as Prisma.InputJsonObject,
    },
  });
}
