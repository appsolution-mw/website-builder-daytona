import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";

describe("durable agent queue schema", () => {
  it("exposes durable queue delegates", () => {
    expect(prisma.workspace).toBeDefined();
    expect(prisma.workspaceMember).toBeDefined();
    expect(prisma.projectQueueState).toBeDefined();
    expect(prisma.agentRun).toBeDefined();
    expect(prisma.agentRunAttempt).toBeDefined();
    expect(prisma.agentRunEvent).toBeDefined();
  });
});
