CREATE TYPE "LibraryItemType" AS ENUM ('SKILL', 'AGENT', 'WORKFLOW_PRESET');
CREATE TYPE "LibraryItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LibraryItemType" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "LibraryItemStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryRevision" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "LibraryRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionLibrarySnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionRuntimeStateId" TEXT NOT NULL,
    "presetItemId" TEXT,
    "presetRevisionId" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionLibrarySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryItem_userId_type_slug_key" ON "LibraryItem"("userId", "type", "slug");
CREATE UNIQUE INDEX "LibraryItem_currentRevisionId_key" ON "LibraryItem"("currentRevisionId");
CREATE UNIQUE INDEX "LibraryItem_id_currentRevisionId_key" ON "LibraryItem"("id", "currentRevisionId");
CREATE INDEX "LibraryItem_userId_type_status_idx" ON "LibraryItem"("userId", "type", "status");
CREATE UNIQUE INDEX "LibraryRevision_itemId_version_key" ON "LibraryRevision"("itemId", "version");
CREATE INDEX "LibraryRevision_itemId_checksum_idx" ON "LibraryRevision"("itemId", "checksum");
CREATE UNIQUE INDEX "LibraryRevision_itemId_id_key" ON "LibraryRevision"("itemId", "id");
CREATE INDEX "LibraryRevision_itemId_createdAt_idx" ON "LibraryRevision"("itemId", "createdAt");
CREATE INDEX "SessionLibrarySnapshot_projectId_sessionId_idx" ON "SessionLibrarySnapshot"("projectId", "sessionId");
CREATE INDEX "SessionLibrarySnapshot_sessionRuntimeStateId_createdAt_idx" ON "SessionLibrarySnapshot"("sessionRuntimeStateId", "createdAt");

ALTER TABLE "LibraryItem"
ADD CONSTRAINT "LibraryItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryItem"
ADD CONSTRAINT "LibraryItem_currentRevisionId_fkey"
FOREIGN KEY ("id", "currentRevisionId") REFERENCES "LibraryRevision"("itemId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "LibraryRevision"
ADD CONSTRAINT "LibraryRevision_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_sessionRuntimeStateId_fkey"
FOREIGN KEY ("sessionRuntimeStateId") REFERENCES "SessionRuntimeState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
