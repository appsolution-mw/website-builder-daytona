import type { AgentRuntime, Prisma } from "@prisma/client";
import type { AgentRuntime as ProtocolAgentRuntime } from "@wbd/protocol";
import { dbRuntimeToProtocol } from "./runtime";

export const sessionRuntimeStateSelect = {
  runtime: true,
  providerSessionId: true,
  modelId: true,
  lastUsedAt: true,
  librarySnapshots: {
    take: 1,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      presetItemId: true,
      presetRevisionId: true,
      snapshotJson: true,
      createdAt: true,
    },
  },
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
  librarySnapshots?: Array<{
    id: string;
    presetItemId: string | null;
    presetRevisionId: string | null;
    snapshotJson: Prisma.JsonValue;
    createdAt: Date;
  }>;
};

type SessionShape = {
  defaultRuntime: AgentRuntime;
  runtimeStates: SessionRuntimeStateShape[];
};

type LibrarySnapshotMetadata = {
  id: string;
  presetItemId: string | null;
  presetRevisionId: string | null;
  snapshotJson: Prisma.JsonValue;
  createdAt: Date;
};

type SerializedRuntimeState = {
  runtime: ProtocolAgentRuntime;
  providerSessionId: string;
  modelId: string | null;
  lastUsedAt: Date;
  librarySnapshot?: LibrarySnapshotMetadata;
};

type SerializedSession<T extends SessionShape> = Omit<T, "defaultRuntime" | "runtimeStates"> & {
  defaultRuntime: ProtocolAgentRuntime;
  runtimeStates: SerializedRuntimeState[];
};

export function serializeRuntimeState<T extends SessionRuntimeStateShape>(
  state: T,
): SerializedRuntimeState {
  const [librarySnapshot] = state.librarySnapshots ?? [];
  return {
    runtime: dbRuntimeToProtocol(state.runtime),
    providerSessionId: state.providerSessionId,
    modelId: state.modelId,
    lastUsedAt: state.lastUsedAt,
    ...(librarySnapshot ? { librarySnapshot } : {}),
  };
}

export function serializeSession<T extends SessionShape>(session: T): SerializedSession<T> {
  const { defaultRuntime, runtimeStates, ...sessionData } = session;
  return {
    ...sessionData,
    defaultRuntime: dbRuntimeToProtocol(defaultRuntime),
    runtimeStates: runtimeStates.map(serializeRuntimeState),
  };
}
