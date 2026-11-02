import type { JobEvent } from "@comfy/shared";
import type { JobContext } from "./jobContext.js";
import { type JobPatch, patchJob } from "./jobRepo.js";

/** Writes the row, then tells live listeners. The row is always updated first. */
export async function updateJob(
  ctx: JobContext,
  jobId: string,
  patch: JobPatch,
  events: JobEvent[] = [],
): Promise<void> {
  await patchJob(ctx.db, jobId, patch);
  for (const event of events) ctx.bus.publish(event);
}

export async function markFailed(ctx: JobContext, jobId: string, message: string): Promise<void> {
  await updateJob(
    ctx,
    jobId,
    { status: "failed", error: message, finishedAt: ctx.now().toISOString() },
    [{ type: "error", jobId, message }],
  );
}

export async function markCancelled(ctx: JobContext, jobId: string): Promise<void> {
  await updateJob(ctx, jobId, { status: "cancelled", finishedAt: ctx.now().toISOString() }, [
    { type: "status", jobId, status: "cancelled" },
  ]);
}

export async function markQueued(
  ctx: JobContext,
  jobId: string,
  extra: JobPatch = {},
): Promise<void> {
  await updateJob(
    ctx,
    jobId,
    { status: "queued", progress: null, promptId: null, startedAt: null, ...extra },
    [{ type: "status", jobId, status: "queued" }],
  );
}

/** Writes progress only when it moved by `step`, to keep the write rate low. */
export function createProgressWriter(
  ctx: JobContext,
  jobId: string,
  step = 0.02,
): (fraction: number) => Promise<void> {
  let last = 0;
  return async (fraction) => {
    const next = Math.min(0.99, Math.max(last, fraction));
    if (next - last < step) return;
    last = next;
    await updateJob(ctx, jobId, { progress: next }, [{ type: "progress", jobId, progress: next }]);
  };
}
