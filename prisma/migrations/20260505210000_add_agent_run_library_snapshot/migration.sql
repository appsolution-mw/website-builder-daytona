ALTER TABLE "AgentRun"
ADD COLUMN "librarySnapshotId" TEXT;

CREATE INDEX "AgentRun_librarySnapshotId_idx" ON "AgentRun"("librarySnapshotId");

ALTER TABLE "AgentRun"
ADD CONSTRAINT "AgentRun_librarySnapshotId_fkey"
FOREIGN KEY ("librarySnapshotId") REFERENCES "SessionLibrarySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
