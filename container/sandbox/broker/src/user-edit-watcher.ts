export interface UserEditDebouncerOptions {
  onTimer: () => Promise<void>;
  isAgentActive: () => boolean;
  delayMs?: number;
}

export interface UserEditDebouncer {
  notify: () => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createUserEditDebouncer(
  opts: UserEditDebouncerOptions,
): UserEditDebouncer {
  const delayMs = opts.delayMs ?? 5_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inProgress: Promise<void> | null = null;
  let pendingAfter = false;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function fire(): Promise<void> {
    if (disposed) return;
    clearTimer();
    if (opts.isAgentActive()) return;
    const run = (async () => {
      try {
        await opts.onTimer();
      } finally {
        inProgress = null;
        if (pendingAfter && !disposed) {
          pendingAfter = false;
          schedule();
        }
      }
    })();
    inProgress = run;
    await run;
  }

  function schedule(): void {
    if (disposed) return;
    if (opts.isAgentActive()) return;
    clearTimer();
    timer = setTimeout(() => {
      void fire();
    }, delayMs);
  }

  return {
    notify(): void {
      if (disposed) return;
      if (opts.isAgentActive()) return;
      if (inProgress) {
        pendingAfter = true;
        return;
      }
      schedule();
    },
    async flush(): Promise<void> {
      if (disposed) return;
      clearTimer();
      if (inProgress) await inProgress;
      await fire();
    },
    dispose(): void {
      disposed = true;
      clearTimer();
    },
  };
}
