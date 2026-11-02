import { isTransient } from "../comfy/errors.js";
import type { ComfyFileRef, ComfyHistoryEntry } from "../comfy/types.js";
import { applyParams } from "../workflows/applyParams.js";
import type { LoadedWorkflow } from "../workflows/loader.js";
import { cleanupComfyFiles } from "./comfyCleanup.js";
import { resolveInputs } from "./inputs.js";
import type { JobContext } from "./jobContext.js";
import { JobFailure, MESSAGES, sanitiseFailure } from "./jobFailure.js";
import type { JobRow } from "./jobRepo.js";
import { createProgressWriter, updateJob } from "./jobState.js";
import { storeJobOutputs } from "./outputs.js";

export type JobOutcome =
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "failed"; message: string }
  | { type: "requeue"; reason: "offline" | "transient" };

/** The in-flight job as the worker tracks it, so a cancel can reach it. */
export interface ActiveJob {
  jobId: string;
  controller: AbortController;
  cancelRequested: boolean;
  promptId?: string;
}

const HISTORY_ATTEMPTS = 4;
const HISTORY_RETRY_MS = 250;

async function isReachable(ctx: JobContext): Promise<boolean> {
  try {
    await ctx.comfy.systemStats();
    return true;
  } catch {
    return false;
  }
}

async function historyWhenFinished(
  ctx: JobContext,
  promptId: string,
): Promise<ComfyHistoryEntry | null> {
  for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt++) {
    const entry = await ctx.comfy.history(promptId);
    if (entry?.completed) return entry;
    await ctx.delay(HISTORY_RETRY_MS);
  }
  return null;
}

/** Submits and follows one prompt. Runs while the GPU lease is held. */
async function runOnGpu(
  ctx: JobContext,
  job: JobRow,
  loaded: LoadedWorkflow,
  active: ActiveJob,
  staged: ComfyFileRef[],
): Promise<JobOutcome> {
  await updateJob(
    ctx,
    job.id,
    { status: "running", startedAt: ctx.now().toISOString(), progress: 0, error: null },
    [{ type: "status", jobId: job.id, status: "running" }],
  );
  const inputs = await resolveInputs(ctx, job, loaded, staged);
  const applied = applyParams(loaded.template, loaded.manifest, inputs);
  const snapshot = { ...applied.values };
  for (const param of loaded.manifest.params) {
    // Image parameters keep the stored ids, not the ComfyUI file names they were uploaded as.
    if ((param.type === "image" || param.type === "images") && param.id in job.params) {
      snapshot[param.id] = job.params[param.id];
    }
  }
  if (active.cancelRequested) return { type: "cancelled" };

  const { promptId } = await ctx.comfy.submit(applied.workflow);
  active.promptId = promptId;
  await updateJob(ctx, job.id, { promptId, params: snapshot });
  if (active.cancelRequested) await ctx.comfy.interrupt().catch(() => undefined);
  const runJob: JobRow = { ...job, params: snapshot, promptId };

  const writeProgress = createProgressWriter(ctx, job.id);
  let entry: ComfyHistoryEntry | null = null;
  try {
    for await (const event of ctx.comfy.watch(promptId, active.controller.signal)) {
      if (event.type === "progress" && event.max > 0) await writeProgress(event.value / event.max);
      if (event.type === "error") {
        ctx.log.error(`[worker] job ${job.id} failed in ComfyUI: ${event.message}`);
        return { type: "failed", message: MESSAGES.failed };
      }
      if (event.type === "interrupted") {
        return active.cancelRequested
          ? { type: "cancelled" }
          : { type: "failed", message: MESSAGES.failed };
      }
    }
  } catch (err) {
    // The socket dropped: the run may still have finished. Collect it rather than run it twice.
    if (!isTransient(err)) throw err;
    entry = await ctx.comfy.history(promptId).catch(() => null);
    if (!entry?.completed) {
      // Only the socket may have dropped: stop the run so a retry does not execute it twice.
      await ctx.comfy.interrupt().catch(() => undefined);
      throw err;
    }
  }
  if (active.cancelRequested) return { type: "cancelled" };
  entry ??= await historyWhenFinished(ctx, promptId);
  if (!entry) throw new JobFailure(MESSAGES.noOutput);
  await storeJobOutputs(ctx, runJob, loaded, entry);
  return { type: "done" };
}

function classify(ctx: JobContext, jobId: string, err: unknown): JobOutcome {
  if (isTransient(err)) {
    ctx.log.warn(
      `[worker] job ${jobId} hit a transient ComfyUI failure (${err instanceof Error ? err.message : "unknown"}); it will be retried`,
    );
    return { type: "requeue", reason: "transient" };
  }
  ctx.log.error(
    `[worker] job ${jobId} failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  return { type: "failed", message: sanitiseFailure(err) };
}

/**
 * One claimed job from GPU wait to result. The lease is always released, and ComfyUI is asked to
 * free its models first so the next GPU user gets the VRAM back.
 */
export async function processJob(
  ctx: JobContext,
  job: JobRow,
  active: ActiveJob,
): Promise<JobOutcome> {
  const loaded = ctx.registry.get(job.workflowId);
  if (!loaded) return { type: "failed", message: MESSAGES.noWorkflow };
  let lease: Awaited<ReturnType<JobContext["gate"]["acquire"]>>;
  try {
    lease = await ctx.gate.acquire({ label: "comfy", signal: active.controller.signal });
  } catch (err) {
    if (active.controller.signal.aborted) return { type: "cancelled" };
    return classify(ctx, job.id, err);
  }
  let touchedComfy = false;
  const staged: ComfyFileRef[] = [];
  try {
    if (active.cancelRequested) return { type: "cancelled" };
    if (!(await isReachable(ctx))) return { type: "requeue", reason: "offline" };
    touchedComfy = true;
    return await runOnGpu(ctx, job, loaded.loaded, active, staged);
  } catch (err) {
    return classify(ctx, job.id, err);
  } finally {
    if (touchedComfy) {
      // Reference uploads are useless once the job ends, whatever the outcome (a retry re-uploads).
      await cleanupComfyFiles(ctx, job.id, staged);
      await ctx.comfy
        .free({ unloadModels: true, freeMemory: true })
        .catch((err) => ctx.log.warn(`[worker] could not free ComfyUI memory: ${String(err)}`));
    }
    try {
      await lease.release();
    } catch (err) {
      // Never let a lease failure overwrite the job's real outcome.
      ctx.log.error(`[worker] could not release the GPU lease: ${String(err)}`);
    }
  }
}
