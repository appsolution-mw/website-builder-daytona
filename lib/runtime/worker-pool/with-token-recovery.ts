import { prisma } from "@/lib/db/client";
import { AgentError, type AgentClient } from "./types";

const BROKER_TOKEN_MISSING = "broker-token-missing";

export async function withTokenRecovery<T>(
  client: AgentClient,
  sandboxId: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isBrokerTokenMissing(err)) throw err;

    const tokenRow = await prisma.sandboxToken.findFirst({
      where: { sandboxId, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: "desc" },
      select: { token: true },
    });
    if (!tokenRow) throw err;

    await client.attachSandboxToken(sandboxId, tokenRow.token);
    return await fn();
  }
}

function isBrokerTokenMissing(err: unknown): err is AgentError {
  return (
    err instanceof AgentError &&
    err.statusCode === 409 &&
    err.errorCode === BROKER_TOKEN_MISSING
  );
}
