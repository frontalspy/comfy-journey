import type { JobContext } from "./jobContext.js";
import { MESSAGES, sanitiseFailure } from "./jobFailure.js";
import { type JobRow, jobsInStatus } from "./jobRepo.js";
import { markFailed, markQueued } from "./jobState.js";
import { storeJobOutputs } from "./outputs.js";

/** A run interrupted by a restart gets one more try; after that it fails. */
const MAX_RECOVERIES = 1;

async function recoverRunning(ctx: JobContext, job: JobRow): Promise<void> {
  const loaded = ctx.registry.get(job.workflowId);
  if (job.promptId && loaded) {
    const entry = await ctx.comfy.history(job.promptId).catch(() => null);
    if (entry?.completed) {
      try {
        await storeJobOutputs(ctx, job, loaded.loaded, entry);
      } catch (err) {
        ctx.log.error(`[recovery] job ${job.id} could not collect its output: ${String(err)}`);
        await markFailed(ctx, job.id, sanitiseFailure(err));
      }
      return;
    }
  }
  if (job.recoveries < MAX_RECOVERIES) {
    await markQueued(ctx, job.id, { recoveries: job.recoveries + 1 });
    return;
  }
  await markFailed(ctx, job.id, MESSAGES.interrupted);
}

/**
 * Boot reconciliation, before the worker starts. Rows left `running` are checked against
 * ComfyUI's history: finished runs are collected, others are requeued once and then failed.
 * Rows left `waiting_for_gpu` never started, so they simply go back to the queue.
 */
export async function recoverInterruptedJobs(ctx: JobContext): Promise<void> {
  for (const job of await jobsInStatus(ctx.db, ["waiting_for_gpu", "running"])) {
    if (job.status === "waiting_for_gpu") await markQueued(ctx, job.id);
    else await recoverRunning(ctx, job);
  }
}
