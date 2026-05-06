export type ProjectRunQueueState = {
  state: "IDLE" | "RUNNING" | "BLOCKED";
  activeRunId: string | null;
  blockedRunId: string | null;
  blockedAt: string | null;
  updatedAt: string | null;
};

export type BlockedRunActionState = {
  blockedRunId: string | null;
  canUnblock: boolean;
};

export function blockedRunActionState(
  queueState: ProjectRunQueueState | null,
): BlockedRunActionState {
  if (queueState?.state !== "BLOCKED" || !queueState.blockedRunId) {
    return { blockedRunId: null, canUnblock: false };
  }

  return {
    blockedRunId: queueState.blockedRunId,
    canUnblock: true,
  };
}
