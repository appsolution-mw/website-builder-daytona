import type { LibraryItem, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { checksumPayload } from "./checksum";
import { createLibraryItem, publishLibraryRevision } from "./service";
import type {
  LibraryExportFile,
  LibraryExportRevision,
  LibraryItemStatus,
  LibraryItemType,
} from "./types";

type ImportLibraryResult = {
  createdItems: number;
  createdRevisions: number;
  skippedRevisions: number;
};

type ExportItem = LibraryExportFile["items"][number];
type ExportRevision = LibraryExportRevision;
type LibraryTransaction = Prisma.TransactionClient;

const typeOrder: Record<LibraryItemType, number> = {
  SKILL: 0,
  AGENT: 1,
  WORKFLOW_PRESET: 2,
};

function sortedTags(tags: string[]): string[] {
  return [...tags].sort();
}

function sortedExportItems(items: LibraryExportFile["items"]): LibraryExportFile["items"] {
  return [...items].sort((left, right) => {
    const leftTypeOrder = typeOrder[left.type];
    const rightTypeOrder = typeOrder[right.type];
    return leftTypeOrder === rightTypeOrder
      ? left.slug.localeCompare(right.slug)
      : leftTypeOrder - rightTypeOrder;
  });
}

function sortedExportRevisions(revisions: ExportRevision[]): ExportRevision[] {
  return [...revisions].sort((left, right) => left.version - right.version);
}

function itemKey(type: LibraryItemType, slug: string): string {
  return `${type}:${slug}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInputJsonValue(value: unknown): Prisma.InputJsonValue {
  checksumPayload(value);
  return value as Prisma.InputJsonValue;
}

function validateExportRevisionChecksum(input: {
  item: ExportItem;
  revision: ExportRevision;
}): string {
  const checksum = checksumPayload({
    content: input.revision.content,
    configJson: input.revision.configJson,
  });
  if (input.revision.checksum && input.revision.checksum !== checksum) {
    throw new Error(`imported revision checksum mismatch for ${input.item.type}:${input.item.slug}`);
  }
  return checksum;
}

async function findLibraryItem(input: {
  tx: LibraryTransaction;
  userId: string;
  type: LibraryItemType;
  slug: string;
}): Promise<LibraryItem | null> {
  return input.tx.libraryItem.findUnique({
    where: {
      userId_type_slug: {
        userId: input.userId,
        type: input.type,
        slug: input.slug,
      },
    },
  });
}

async function createImportedItem(input: {
  tx: LibraryTransaction;
  userId: string;
  item: ExportItem;
}): Promise<LibraryItem> {
  return createLibraryItem({
    tx: input.tx,
    userId: input.userId,
    type: input.item.type,
    slug: input.item.slug,
    name: input.item.name,
    description: input.item.description,
    tags: sortedTags(input.item.tags),
  });
}

async function updateItemMetadata(input: {
  tx: LibraryTransaction;
  itemId: string;
  item: ExportItem;
}): Promise<void> {
  await input.tx.libraryItem.update({
    where: { id: input.itemId },
    data: {
      name: input.item.name,
      description: input.item.description,
      tags: sortedTags(input.item.tags),
    },
  });
}

async function updateItemStatus(input: {
  tx: LibraryTransaction;
  itemId: string;
  status: LibraryItemStatus;
}): Promise<void> {
  await input.tx.libraryItem.update({
    where: { id: input.itemId },
    data: { status: input.status },
  });
}

function exportedRevisionsForImport(item: ExportItem): ExportRevision[] {
  if (Array.isArray(item.revisions) && item.revisions.length > 0) {
    const revisions = [...item.revisions];
    const currentSourceRevisionId = item.currentRevision ? sourceRevisionId(item.currentRevision) : null;
    const hasCurrentRevision = item.currentRevision
      ? revisions.some((revision) =>
          currentSourceRevisionId
            ? sourceRevisionId(revision) === currentSourceRevisionId
            : revision.checksum === item.currentRevision?.checksum,
        )
      : true;
    if (item.currentRevision && !hasCurrentRevision) {
      revisions.push(item.currentRevision);
    }
    return sortedExportRevisions(revisions);
  }
  return item.currentRevision ? [item.currentRevision] : [];
}

function sourceRevisionId(revision: ExportRevision): string | null {
  return typeof revision.sourceRevisionId === "string" && revision.sourceRevisionId
    ? revision.sourceRevisionId
    : null;
}

async function findExistingRevisionByChecksum(input: {
  tx: LibraryTransaction;
  itemId: string;
  checksum: string;
}): Promise<{ id: string } | null> {
  return input.tx.libraryRevision.findFirst({
    where: {
      itemId: input.itemId,
      checksum: input.checksum,
    },
    select: { id: true },
    orderBy: { version: "asc" },
  });
}

async function ensureImportedRevision(input: {
  tx: LibraryTransaction;
  userId: string;
  item: LibraryItem;
  revision: ExportRevision;
  reuseHistoricalRevision: boolean;
}): Promise<{ id: string; created: boolean }> {
  const checksum = validateExportRevisionChecksum({
    item: {
      type: input.item.type,
      slug: input.item.slug,
      name: input.item.name,
      description: input.item.description,
      tags: input.item.tags,
      status: input.item.status,
      currentRevision: null,
    },
    revision: input.revision,
  });
  const existingRevision = input.reuseHistoricalRevision
    ? await findExistingRevisionByChecksum({
        tx: input.tx,
        itemId: input.item.id,
        checksum,
      })
    : await input.tx.libraryItem
        .findUnique({
          where: { id: input.item.id },
          select: { currentRevision: { select: { id: true, checksum: true } } },
        })
        .then((current) =>
          current?.currentRevision?.checksum === checksum
            ? { id: current.currentRevision.id }
            : null,
        );
  if (existingRevision) {
    return { id: existingRevision.id, created: false };
  }

  if (input.item.status === "ARCHIVED") {
    await updateItemStatus({ tx: input.tx, itemId: input.item.id, status: "DRAFT" });
  }
  const revision = await publishLibraryRevision({
    tx: input.tx,
    userId: input.userId,
    itemId: input.item.id,
    title: input.revision.title,
    content: input.revision.content,
    configJson: asInputJsonValue(input.revision.configJson),
    changeNote: input.revision.changeNote || "Imported revision",
  });
  input.item.status = "PUBLISHED";
  return { id: revision.id, created: true };
}

async function setCurrentRevision(input: {
  tx: LibraryTransaction;
  itemId: string;
  revisionId: string;
}): Promise<void> {
  await input.tx.libraryItem.update({
    where: { id: input.itemId },
    data: { currentRevisionId: input.revisionId },
  });
}

function remapPresetEntry(input: {
  entry: unknown;
  expectedType: "SKILL" | "AGENT";
  targetItemIdByKey: Map<string, string>;
  targetRevisionIdByKey: Map<string, string>;
  sourceItemIdToTargetItemId: Map<string, string>;
  sourceRevisionIdToTargetRevisionId: Map<string, string>;
}): { itemId: string; revisionId: string; enabled: boolean } {
  if (!isRecord(input.entry)) {
    throw new Error(`missing imported ${input.expectedType.toLowerCase()} dependency for workflow preset`);
  }

  const itemSlug = typeof input.entry.itemSlug === "string"
    ? input.entry.itemSlug
    : typeof input.entry.slug === "string"
      ? input.entry.slug
      : null;
  const itemType = typeof input.entry.itemType === "string" ? input.entry.itemType : input.expectedType;
  const targetItemKey = itemSlug && itemType === input.expectedType
    ? itemKey(input.expectedType, itemSlug)
    : null;
  const sourceItemId = typeof input.entry.itemId === "string" ? input.entry.itemId : null;
  const sourceRevisionId = typeof input.entry.revisionId === "string" ? input.entry.revisionId : null;

  const targetItemId = targetItemKey
    ? input.targetItemIdByKey.get(targetItemKey)
    : sourceItemId
      ? input.sourceItemIdToTargetItemId.get(sourceItemId)
      : undefined;
  const targetRevisionId = sourceRevisionId
    ? input.sourceRevisionIdToTargetRevisionId.get(sourceRevisionId)
      ?? (targetItemKey ? input.targetRevisionIdByKey.get(targetItemKey) : undefined)
    : targetItemKey
      ? input.targetRevisionIdByKey.get(targetItemKey)
      : undefined;

  if (!targetItemId || !targetRevisionId) {
    throw new Error(`missing imported ${input.expectedType.toLowerCase()} dependency for workflow preset`);
  }

  if (sourceItemId) {
    input.sourceItemIdToTargetItemId.set(sourceItemId, targetItemId);
  }
  if (sourceRevisionId) {
    input.sourceRevisionIdToTargetRevisionId.set(sourceRevisionId, targetRevisionId);
  }

  return {
    itemId: targetItemId,
    revisionId: targetRevisionId,
    enabled: input.entry.enabled !== false,
  };
}

function remapPresetConfig(input: {
  configJson: unknown;
  targetItemIdByKey: Map<string, string>;
  targetRevisionIdByKey: Map<string, string>;
  sourceItemIdToTargetItemId: Map<string, string>;
  sourceRevisionIdToTargetRevisionId: Map<string, string>;
}): Prisma.InputJsonValue {
  if (!isRecord(input.configJson)) {
    return asInputJsonValue(input.configJson);
  }

  const skills = Array.isArray(input.configJson.skills)
    ? input.configJson.skills.map((entry) =>
        remapPresetEntry({
          entry,
          expectedType: "SKILL",
          targetItemIdByKey: input.targetItemIdByKey,
          targetRevisionIdByKey: input.targetRevisionIdByKey,
          sourceItemIdToTargetItemId: input.sourceItemIdToTargetItemId,
          sourceRevisionIdToTargetRevisionId: input.sourceRevisionIdToTargetRevisionId,
        }),
      )
    : input.configJson.skills;
  const agents = Array.isArray(input.configJson.agents)
    ? input.configJson.agents.map((entry) =>
        remapPresetEntry({
          entry,
          expectedType: "AGENT",
          targetItemIdByKey: input.targetItemIdByKey,
          targetRevisionIdByKey: input.targetRevisionIdByKey,
          sourceItemIdToTargetItemId: input.sourceItemIdToTargetItemId,
          sourceRevisionIdToTargetRevisionId: input.sourceRevisionIdToTargetRevisionId,
        }),
      )
    : input.configJson.agents;

  return asInputJsonValue({
    ...input.configJson,
    skills,
    agents,
  });
}

function enrichPresetEntryForExport(input: {
  entry: unknown;
  itemById: Map<string, Pick<LibraryItem, "id" | "type" | "slug">>;
}): unknown {
  if (!isRecord(input.entry) || typeof input.entry.itemId !== "string") {
    return input.entry;
  }
  const item = input.itemById.get(input.entry.itemId);
  if (!item) return input.entry;

  return {
    ...input.entry,
    itemType: item.type,
    itemSlug: item.slug,
  };
}

function exportConfigJson(input: {
  item: Pick<LibraryItem, "type">;
  configJson: unknown;
  itemById: Map<string, Pick<LibraryItem, "id" | "type" | "slug">>;
}): unknown {
  if (input.item.type !== "WORKFLOW_PRESET" || !isRecord(input.configJson)) {
    return input.configJson;
  }

  return {
    ...input.configJson,
    skills: Array.isArray(input.configJson.skills)
      ? input.configJson.skills.map((entry) =>
          enrichPresetEntryForExport({ entry, itemById: input.itemById }),
        )
      : input.configJson.skills,
    agents: Array.isArray(input.configJson.agents)
      ? input.configJson.agents.map((entry) =>
          enrichPresetEntryForExport({ entry, itemById: input.itemById }),
        )
      : input.configJson.agents,
  };
}

function exportRevision(input: {
  item: Pick<LibraryItem, "type">;
  revision: {
    id: string;
    version: number;
    title: string;
    content: string;
    configJson: unknown;
    changeNote: string;
  };
  itemById: Map<string, Pick<LibraryItem, "id" | "type" | "slug">>;
}): ExportRevision {
  const configJson = exportConfigJson({
    item: input.item,
    configJson: input.revision.configJson,
    itemById: input.itemById,
  });
  return {
    sourceRevisionId: input.revision.id,
    version: input.revision.version,
    title: input.revision.title,
    content: input.revision.content,
    configJson,
    checksum: checksumPayload({ content: input.revision.content, configJson }),
    changeNote: input.revision.changeNote,
  };
}

export async function exportLibrary(input: {
  userId: string;
  exportedAt?: string;
}): Promise<LibraryExportFile> {
  const items = await prisma.libraryItem.findMany({
    where: { userId: input.userId },
    include: {
      currentRevision: true,
      revisions: { orderBy: { version: "asc" } },
    },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
  });
  const itemById = new Map<string, Pick<LibraryItem, "id" | "type" | "slug">>(
    items.map((item) => [item.id, item]),
  );

  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    items: sortedExportItems(
      items.map((item) => ({
        type: item.type,
        slug: item.slug,
        name: item.name,
        description: item.description,
        tags: sortedTags(item.tags),
        status: item.status,
        currentRevision: item.currentRevision
          ? exportRevision({ item, revision: item.currentRevision, itemById })
          : null,
        revisions: sortedExportRevisions(
          item.revisions.map((revision) => exportRevision({ item, revision, itemById })),
        ),
      })),
    ),
  };
}

export async function importLibrary(input: {
  userId: string;
  file: LibraryExportFile;
}): Promise<ImportLibraryResult> {
  if (input.file.schemaVersion !== 1) {
    throw new Error("unsupported library export schema version");
  }

  const sortedItems = sortedExportItems(input.file.items);
  for (const exportedItem of sortedItems) {
    for (const revision of exportedRevisionsForImport(exportedItem)) {
      validateExportRevisionChecksum({
        item: exportedItem,
        revision,
      });
    }
  }

  return prisma.$transaction(async (tx): Promise<ImportLibraryResult> => {
    let createdItems = 0;
    let createdRevisions = 0;
    let skippedRevisions = 0;
    const targetItemIdByKey = new Map<string, string>();
    const targetRevisionIdByKey = new Map<string, string>();
    const sourceItemIdToTargetItemId = new Map<string, string>();
    const sourceRevisionIdToTargetRevisionId = new Map<string, string>();

    for (const exportedItem of sortedItems) {
      let item = await findLibraryItem({
        tx,
        userId: input.userId,
        type: exportedItem.type,
        slug: exportedItem.slug,
      });

      if (!item) {
        item = await createImportedItem({ tx, userId: input.userId, item: exportedItem });
        createdItems += 1;
      }
      await updateItemMetadata({ tx, itemId: item.id, item: exportedItem });
      targetItemIdByKey.set(itemKey(exportedItem.type, exportedItem.slug), item.id);
    }

    for (const exportedItem of sortedItems) {
      if (exportedItem.type === "WORKFLOW_PRESET") continue;
      const itemId = targetItemIdByKey.get(itemKey(exportedItem.type, exportedItem.slug));
      if (!itemId) {
        throw new Error(`missing imported item for ${exportedItem.type}:${exportedItem.slug}`);
      }
      const item = await tx.libraryItem.findUniqueOrThrow({ where: { id: itemId } });
      const exportedRevisions = exportedRevisionsForImport(exportedItem);
      const reuseHistoricalRevision = Array.isArray(exportedItem.revisions) && exportedItem.revisions.length > 0;
      if (exportedRevisions.length === 0) {
        await updateItemStatus({ tx, itemId, status: exportedItem.status });
        continue;
      }

      let currentTargetRevisionId: string | null = null;
      for (const exportedRevision of exportedRevisions) {
        const ensured = await ensureImportedRevision({
          tx,
          userId: input.userId,
          item,
          revision: exportedRevision,
          reuseHistoricalRevision,
        });
        if (ensured.created) {
          createdRevisions += 1;
        } else {
          skippedRevisions += 1;
        }
        const revisionSourceId = sourceRevisionId(exportedRevision);
        if (revisionSourceId) {
          sourceRevisionIdToTargetRevisionId.set(revisionSourceId, ensured.id);
        }
        if (
          exportedItem.currentRevision &&
          exportedRevision.checksum === exportedItem.currentRevision.checksum
        ) {
          currentTargetRevisionId = ensured.id;
        }
      }
      if (currentTargetRevisionId) {
        targetRevisionIdByKey.set(itemKey(exportedItem.type, exportedItem.slug), currentTargetRevisionId);
        await setCurrentRevision({ tx, itemId, revisionId: currentTargetRevisionId });
      }
      await updateItemStatus({ tx, itemId, status: exportedItem.status });
    }

    for (const exportedItem of sortedItems) {
      if (exportedItem.type !== "WORKFLOW_PRESET") continue;
      const itemId = targetItemIdByKey.get(itemKey(exportedItem.type, exportedItem.slug));
      if (!itemId) {
        throw new Error(`missing imported item for ${exportedItem.type}:${exportedItem.slug}`);
      }
      const item = await tx.libraryItem.findUniqueOrThrow({ where: { id: itemId } });
      const exportedRevisions = exportedRevisionsForImport(exportedItem);
      const reuseHistoricalRevision = Array.isArray(exportedItem.revisions) && exportedItem.revisions.length > 0;
      if (exportedRevisions.length === 0) {
        await updateItemStatus({ tx, itemId, status: exportedItem.status });
        continue;
      }

      let currentTargetRevisionId: string | null = null;
      const currentSourceRevisionId = exportedItem.currentRevision
        ? sourceRevisionId(exportedItem.currentRevision)
        : null;
      for (const exportedRevision of exportedRevisions) {
        const configJson = remapPresetConfig({
          configJson: exportedRevision.configJson,
          targetItemIdByKey,
          targetRevisionIdByKey,
          sourceItemIdToTargetItemId,
          sourceRevisionIdToTargetRevisionId,
        });
        const remappedRevision: ExportRevision = {
          ...exportedRevision,
          configJson,
          checksum: checksumPayload({
            content: exportedRevision.content,
            configJson,
          }),
        };
        const ensured = await ensureImportedRevision({
          tx,
          userId: input.userId,
          item,
          revision: remappedRevision,
          reuseHistoricalRevision,
        });
        if (ensured.created) {
          createdRevisions += 1;
        } else {
          skippedRevisions += 1;
        }
        const revisionSourceId = sourceRevisionId(exportedRevision);
        if (revisionSourceId) {
          sourceRevisionIdToTargetRevisionId.set(revisionSourceId, ensured.id);
        }
        const isCurrentRevision = currentSourceRevisionId
          ? revisionSourceId === currentSourceRevisionId
          : exportedItem.currentRevision?.checksum === exportedRevision.checksum;
        if (isCurrentRevision) {
          currentTargetRevisionId = ensured.id;
        }
      }
      if (currentTargetRevisionId) {
        targetRevisionIdByKey.set(itemKey(exportedItem.type, exportedItem.slug), currentTargetRevisionId);
        await setCurrentRevision({ tx, itemId, revisionId: currentTargetRevisionId });
      }
      await updateItemStatus({ tx, itemId, status: exportedItem.status });
    }

    return { createdItems, createdRevisions, skippedRevisions };
  });
}
