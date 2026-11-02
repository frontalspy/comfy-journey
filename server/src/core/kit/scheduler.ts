/** setTimeout stores its delay in a signed 32-bit int; anything larger fires immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Runs `task` every `intervalMs`, safely beyond setTimeout's ~24.8-day ceiling. Returns a stop
 * function that cancels whatever timer is pending. Does not run `task` immediately.
 */
export function scheduleRecurring(intervalMs: number, task: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  function waitThenRun(remainingMs: number): void {
    if (stopped) return;
    if (remainingMs > MAX_TIMEOUT_MS) {
      timer = setTimeout(() => waitThenRun(remainingMs - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
      return;
    }
    timer = setTimeout(() => {
      task();
      waitThenRun(intervalMs);
    }, remainingMs);
  }

  waitThenRun(intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
