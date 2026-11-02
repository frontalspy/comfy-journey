/**
 * Runs `task` every `intervalMs` and returns a stop function. Server-kit's scheduleRecurring does
 * exactly this but is not in its public exports yet; swap this for it once it is (a day is far
 * below setTimeout's 24.8-day ceiling, so no chunking is needed here).
 */
export function scheduleEvery(intervalMs: number, task: () => void): () => void {
  const timer = setInterval(task, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
