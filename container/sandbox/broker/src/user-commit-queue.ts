export interface UserCommitPayload {
  sha: string;
  shortSha: string;
  title: string;
  bodyMessage: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  userEmail: string;
  committedAt: string;
}

export interface UserCommitQueue {
  enqueue: (payload: UserCommitPayload) => void;
  pullPending: (opts: { timeoutMs: number }) => Promise<UserCommitPayload[]>;
  ack: (sha: string) => void;
}

export function createUserCommitQueue(): UserCommitQueue {
  const pending = new Map<string, UserCommitPayload>();
  const waiters: Array<() => void> = [];

  function notify(): void {
    while (waiters.length > 0) {
      const w = waiters.shift();
      if (w) w();
    }
  }

  return {
    enqueue(payload: UserCommitPayload): void {
      pending.set(payload.sha, payload);
      notify();
    },
    async pullPending({ timeoutMs }: { timeoutMs: number }): Promise<UserCommitPayload[]> {
      if (pending.size > 0) {
        return Array.from(pending.values());
      }
      await new Promise<void>((resolve) => {
        const onArrival = (): void => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(onArrival);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve();
        }, timeoutMs);
        waiters.push(onArrival);
      });
      return Array.from(pending.values());
    },
    ack(sha: string): void {
      pending.delete(sha);
    },
  };
}
