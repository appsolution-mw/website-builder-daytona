-- AlterEnum
ALTER TYPE "CommitAuthorKind" ADD VALUE 'ROLLBACK';

-- AlterTable
ALTER TABLE "Commit" ADD COLUMN     "revertedFromSha" TEXT;
