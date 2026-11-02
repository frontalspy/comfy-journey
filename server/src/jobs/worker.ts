import type { JobContext } from "./jobContext.js";
import { MESSAGES, sanitiseFailure } from "./jobFailure.js";
import { claimNextJob, type JobRow } from "./jobRepo.js";
import { type ActiveJob, type JobOutcome, processJob } from "./jobRunner.js";
import { markCancelled, markFailed, markQueued } from "./jobState.js";

const DEFAULT_POLL_MS = 2000;

/**
 * The single in-process worker: strictly one job at a time across every user. It claims the
 * oldest queued job, waits for the GPU through the injected gate, runs it, then applies the
 * outcome. Transient failures and an offline ComfyUI keep the job queued and back off.
 */
export class JobWorker {
  private stopped = true;
  private loop: Promise<void> | undefined;
  private current: Promise<void> | undefined;
  private active: (ActiveJob & { stopRequested: boolean }) | undefined;
  private wakeUp: (() => void) | undefined;
  private readonly shutdown = new AbortController();
  private offlineStreak = 0;
  private readonly transientAttempts = new Map<string, number>();

  constructor(
    private readonly ctx: JobContext,
    private readonly pollIntervalMs = DEFAULT_POLL_MS,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.shutdown.abort();
    if (this.active) {
      this.active.stopRequested = true;
      this.active.controller.abort();
    }
    this.wake();
    await this.loop;
  }

  /** A job was queued: look for work now instead of at the next poll. */
  wake(): void {
    this.wakeUp?.();
  }

  /**
   * Asks the in-flight job to stop and resolves once the worker has finished with it. False when
   * the worker is not currently handling `jobId`.
   */
  async cancel(jobId: string): Promise<boolean> {
    const active = this.active;
    if (!active || active.jobId !== jobId) return false;
    active.cancelRequested = true;
    active.controller.abort();
    if (active.promptId) await this.ctx.comfy.interrupt().catch(() => undefined);
    await this.current;
    return true;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let job: JobRow | undefined;
      try {
        job = await claimNextJob(this.ctx.db);
      } catch (err) {
        this.ctx.log.error(`[worker] could not claim a job: ${String(err)}`);
      }
      if (!job) {
        await this.idle();
        continue;
      }
      this.current = this.handle(job);
      await this.current;
    }
  }

  private idle(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.wakeUp = undefined;
        resolve();
      };
      const timer = setTimeout(done, this.pollIntervalMs);
      this.wakeUp = done;
    });
  }

  private async handle(job: JobRow): Promise<void> {
    const active = {
      jobId: job.id,
      controller: new AbortController(),
      cancelRequested: false,
      stopRequested: false,
    };
    this.active = active;
    this.ctx.bus.publish({ type: "status", jobId: job.id, status: "waiting_for_gpu" });
    let outcome: JobOutcome;
    try {
      outcome = await processJob(this.ctx, job, active);
    } catch (err) {
      this.ctx.log.error(`[worker] job ${job.id} crashed: ${String(err)}`);
      outcome = { type: "failed", message: sanitiseFailure(err) };
    }
    // A cancel that raced the outcome (a failure, or a requeue that would wait out a retry delay) wins.
    if (active.cancelRequested && outcome.type !== "done") outcome = { type: "cancelled" };
    try {
      if (!active.stopRequested) await this.apply(job, outcome);
    } catch (err) {
      this.ctx.log.error(`[worker] could not record the outcome of job ${job.id}: ${String(err)}`);
    } finally {
      this.active = undefined;
    }
  }

  private async apply(job: JobRow, outcome: JobOutcome): Promise<void> {
    const { ctx } = this;
    switch (outcome.type) {
      case "done":
        this.offlineStreak = 0;
        this.transientAttempts.delete(job.id);
        return;
      case "cancelled":
        this.transientAttempts.delete(job.id);
        await markCancelled(ctx, job.id);
        return;
      case "failed":
        this.transientAttempts.delete(job.id);
        await markFailed(ctx, job.id, outcome.message);
        return;
      case "requeue":
        await this.requeue(job, outcome.reason);
    }
  }

  private async requeue(job: JobRow, reason: "offline" | "transient"): Promise<void> {
    const delays = this.ctx.retryDelaysMs;
    let streak: number;
    if (reason === "offline") {
      streak = ++this.offlineStreak;
    } else {
      streak = (this.transientAttempts.get(job.id) ?? 0) + 1;
      this.transientAttempts.set(job.id, streak);
      if (streak > delays.length) {
        this.transientAttempts.delete(job.id);
        await markFailed(this.ctx, job.id, MESSAGES.unavailable);
        return;
      }
    }
    await markQueued(this.ctx, job.id);
    const wait = delays[Math.min(streak, delays.length) - 1] ?? 0;
    await this.ctx.delay(wait, this.shutdown.signal);
  }
}
