-- CreateEnum
CREATE TYPE "AgentConfigMode" AS ENUM ('INHERIT', 'EXTEND', 'REPLACE');

-- CreateEnum
CREATE TYPE "AgentConfigSource" AS ENUM ('WORKSPACE', 'PROJECT', 'LEGACY_FILE');

-- CreateEnum
CREATE TYPE "EnablementState" AS ENUM ('ENABLED', 'DISABLED', 'INHERITED');

-- CreateTable
CREATE TABLE "WorkspaceAgentConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "agentsMd" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAgentConfig" (
    "projectId" TEXT NOT NULL,
    "agentsMode" "AgentConfigMode" NOT NULL DEFAULT 'EXTEND',
    "agentsMd" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAgentConfig_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AgentSkillDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "triggers" JSONB,
    "source" "AgentConfigSource" NOT NULL DEFAULT 'WORKSPACE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "tools" JSONB,
    "model" TEXT NOT NULL DEFAULT 'inherit',
    "skillNames" JSONB,
    "permissionMode" TEXT,
    "source" "AgentConfigSource" NOT NULL DEFAULT 'WORKSPACE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSkillEnablement" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "projectId" TEXT,
    "state" "EnablementState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSkillEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDefinitionEnablement" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT,
    "state" "EnablementState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDefinitionEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkillDefinition_name_key" ON "AgentSkillDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_name_key" ON "AgentDefinition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkillEnablement_skillId_projectId_key" ON "AgentSkillEnablement"("skillId", "projectId");

-- CreateIndex
CREATE INDEX "AgentSkillEnablement_projectId_idx" ON "AgentSkillEnablement"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinitionEnablement_agentId_projectId_key" ON "AgentDefinitionEnablement"("agentId", "projectId");

-- CreateIndex
CREATE INDEX "AgentDefinitionEnablement_projectId_idx" ON "AgentDefinitionEnablement"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectAgentConfig"
ADD CONSTRAINT "ProjectAgentConfig_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkillEnablement"
ADD CONSTRAINT "AgentSkillEnablement_skillId_fkey"
FOREIGN KEY ("skillId") REFERENCES "AgentSkillDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSkillEnablement"
ADD CONSTRAINT "AgentSkillEnablement_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDefinitionEnablement"
ADD CONSTRAINT "AgentDefinitionEnablement_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDefinitionEnablement"
ADD CONSTRAINT "AgentDefinitionEnablement_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
