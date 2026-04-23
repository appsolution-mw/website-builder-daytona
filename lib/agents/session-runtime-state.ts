import type { AgentRuntime, Prisma } from "@prisma/client";
import { dbRuntimeToProtocol } from "./runtime";

export const sessionRuntimeStateSelect = {
  runtime: true,
  providerSessionId: true,
  modelId: true,
  lastUsedAt: true,
} satisfies Prisma.SessionRuntimeStateSelect;

export const sessionSelect = {
  id: true,
  title: true,
  defaultRuntime: true,
  createdAt: true,
  lastMessageAt: true,
  runtimeStates: {
    orderBy: { lastUsedAt: "desc" },
    select: sessionRuntimeStateSelect,
  },
  _count: { select: { messages: true } },
} satisfies Prisma.SessionSelect;

type SessionRuntimeStateShape = {
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId: string | null;
  lastUsedAt: Date;
};

type SessionShape = {
  defaultRuntime: AgentRuntime;
  runtimeStates: SessionRuntimeStateShape[];
};

export function serializeRuntimeState<T extends SessionRuntimeStateShape>(state: T) {
  return {
    runtime: dbRuntimeToProtocol(state.runtime),
    providerSessionId: state.providerSessionId,
    modelId: state.modelId,
    lastUsedAt: state.lastUsedAt,
  };
}

export function serializeSession<T extends SessionShape>(session: T) {
  return {
    ...session,
    defaultRuntime: dbRuntimeToProtocol(session.defaultRuntime),
    runtimeStates: session.runtimeStates.map(serializeRuntimeState),
  };
}
