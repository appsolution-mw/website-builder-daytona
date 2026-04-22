-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "brokerPreviewToken" TEXT,
ADD COLUMN     "brokerUrl" TEXT,
ADD COLUMN     "daytonaSandboxId" TEXT,
ADD COLUMN     "previewUrl" TEXT,
ADD COLUMN     "provisioningError" TEXT;
