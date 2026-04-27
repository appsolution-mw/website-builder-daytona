-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('PROVISIONING', 'READY', 'DRAINING', 'DECOMMISSIONED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SandboxLifecycleStatus" AS ENUM ('SPAWNING', 'RUNNING', 'PAUSED', 'DESTROYED');

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "tailscaleHostname" TEXT NOT NULL,
    "tailscaleIp" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVmId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "WorkerStatus" NOT NULL DEFAULT 'PROVISIONING',
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decommissionedAt" TIMESTAMP(3),

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSandbox" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "brokerPort" INTEGER NOT NULL,
    "previewPort" INTEGER NOT NULL,
    "status" "SandboxLifecycleStatus" NOT NULL DEFAULT 'SPAWNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerSandbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SandboxToken" (
    "id" TEXT NOT NULL,
    "sandboxId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Worker_tailscaleHostname_key" ON "Worker"("tailscaleHostname");

-- CreateIndex
CREATE INDEX "Worker_status_idx" ON "Worker"("status");

-- CreateIndex
CREATE INDEX "Worker_provider_region_idx" ON "Worker"("provider", "region");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSandbox_projectId_key" ON "WorkerSandbox"("projectId");

-- CreateIndex
CREATE INDEX "WorkerSandbox_workerId_idx" ON "WorkerSandbox"("workerId");

-- CreateIndex
CREATE INDEX "WorkerSandbox_status_idx" ON "WorkerSandbox"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxToken_sandboxId_key" ON "SandboxToken"("sandboxId");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxToken_token_key" ON "SandboxToken"("token");

-- CreateIndex
CREATE INDEX "SandboxToken_expiresAt_idx" ON "SandboxToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "WorkerSandbox" ADD CONSTRAINT "WorkerSandbox_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
