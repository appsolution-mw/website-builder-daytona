import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserEditDebouncer } from "../src/user-edit-watcher";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createUserEditDebouncer", () => {
  it("fires onTimer 5s after a single notify", async () => {
    const onTimer = vi.fn().mockResolvedValue(undefined);
    const isAgentActive = () => false;
    const d = createUserEditDebouncer({ onTimer, isAgentActive });

    d.notify();
    expect(onTimer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4999);
    expect(onTimer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onTimer).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on each notify within the window", async () => {
    const onTimer = vi.fn().mockResolvedValue(undefined);
    const d = createUserEditDebouncer({ onTimer, isAgentActive: () => false });
    d.notify();
    await vi.advanceTimersByTimeAsync(4000);
    d.notify();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onTimer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(onTimer).toHaveBeenCalledTimes(1);
  });

  it("skips notify while an agent run is active", async () => {
    const onTimer = vi.fn().mockResolvedValue(undefined);
    let active = true;
    const d = createUserEditDebouncer({
      onTimer,
      isAgentActive: () => active,
    });
    d.notify();
    await vi.advanceTimersByTimeAsync(6000);
    expect(onTimer).not.toHaveBeenCalled();
    active = false;
    d.notify();
    await vi.advanceTimersByTimeAsync(5100);
    expect(onTimer).toHaveBeenCalledTimes(1);
  });

  it("queues a fresh timer if a notify arrives during an in-progress commit", async () => {
    let resolveOnTimer: () => void = () => {};
    const onTimer = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveOnTimer = r; }),
    );
    const d = createUserEditDebouncer({
      onTimer,
      isAgentActive: () => false,
    });
    d.notify();
    await vi.advanceTimersByTimeAsync(5100);
    expect(onTimer).toHaveBeenCalledTimes(1);
    d.notify();
    resolveOnTimer();
    await vi.runAllTimersAsync();
    expect(onTimer).toHaveBeenCalledTimes(2);
  });

  it("flush() runs onTimer immediately and clears any pending timer", async () => {
    const onTimer = vi.fn().mockResolvedValue(undefined);
    const d = createUserEditDebouncer({
      onTimer,
      isAgentActive: () => false,
    });
    d.notify();
    await vi.advanceTimersByTimeAsync(2000);
    await d.flush();
    expect(onTimer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(onTimer).toHaveBeenCalledTimes(1);
  });

  it("flush() awaits an in-progress commit and then fires once more", async () => {
    let resolveInProgress: () => void = () => {};
    const onTimer = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => { resolveInProgress = r; }),
      )
      .mockResolvedValue(undefined);
    const d = createUserEditDebouncer({
      onTimer,
      isAgentActive: () => false,
    });
    d.notify();
    await vi.advanceTimersByTimeAsync(5100);
    const flushPromise = d.flush();
    resolveInProgress();
    await flushPromise;
    expect(onTimer).toHaveBeenCalledTimes(2);
  });
});
