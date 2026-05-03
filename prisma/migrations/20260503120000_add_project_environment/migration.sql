-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "ProjectEnvironment"
ADD CONSTRAINT "ProjectEnvironment_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
