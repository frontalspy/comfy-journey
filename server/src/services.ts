import { type ComfyClient, createComfyClient } from "./comfy/client.js";
import type { AppConfig } from "./config.js";
import type { BackupService } from "./core/kit/index.js";
import { createAppBackup } from "./db/backup.js";
import { type AppDatabase, type AppDbHandle, openAppDb } from "./db/client.js";
import { UPLOAD_LIMITS } from "./images/uploadLimits.js";
import type { GpuGate } from "./jobs/gpuGate.js";
import type { JobContext } from "./jobs/jobContext.js";
import { JobEventBus } from "./jobs/jobEvents.js";
import { JobService } from "./jobs/jobService.js";
import { OwnerRateLimiter } from "./jobs/rateLimiter.js";
import { recoverInterruptedJobs } from "./jobs/recovery.js";
import { JobWorker } from "./jobs/worker.js";
import { LIMITS } from "./limits.js";
import { createMediaBackend } from "./storage/createMediaBackend.js";
import type { MediaBackend } from "./storage/mediaBackend.js";
import { MediaStore } from "./storage/mediaStore.js";
import { scheduleEvery } from "./storage/scheduleDaily.js";
import { runSweep, type SweepResult } from "./storage/sweep.js";
import { WorkflowRegistry } from "./workflows/registry.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Waits after a transient failure or an outage; the last value repeats while ComfyUI is down. */
const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

export interface AppOptions {
  /** Required: production passes createGpuGate(config), tests pass an in-memory gate. */
  gate: GpuGate;
  comfy?: ComfyClient;
  /** Overrides MEDIA_STORE; tests pass a fake bucket. */
  media?: MediaBackend;
  now?: () => Date;
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryDelaysMs?: readonly number[];
  pollIntervalMs?: number;
  heartbeatMs?: number;
  /** How long GET /api/system trusts a ComfyUI reachability probe. */
  systemCacheMs?: number;
  log?: Pick<Console, "log" | "warn" | "error">;
}

export interface AppServices {
  config: AppConfig;
  handle: AppDbHandle;
  db: AppDatabase;
  ctx: JobContext;
  worker: JobWorker;
  jobs: JobService;
  limiter: OwnerRateLimiter;
  uploadLimiter: OwnerRateLimiter;
  backup: BackupService;
  heartbeatMs: number;
  systemCacheMs: number;
  sweep(): Promise<SweepResult>;
  /** Refreshes workflows, reconciles interrupted jobs, starts the worker and the daily sweep. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const realDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

export async function createAppServices(
  config: AppConfig,
  options: AppOptions,
): Promise<AppServices> {
  const handle = await openAppDb(config.dataDir);
  const log = options.log ?? console;
  const now = options.now ?? (() => new Date());
  const comfy =
    options.comfy ??
    createComfyClient({ baseUrl: config.comfyUrl, cleanupToken: config.comfyCleanupToken });
  const store = new MediaStore(options.media ?? createMediaBackend(config), log);
  const ctx: JobContext = {
    db: handle.db,
    comfy,
    gate: options.gate,
    store,
    registry: new WorkflowRegistry(config.workflowsDir, comfy, config.allowNsfwWorkflows, log),
    bus: new JobEventBus(),
    now,
    delay: options.delay ?? realDelay,
    retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    log,
  };
  const worker = new JobWorker(ctx, options.pollIntervalMs);
  const limiter = new OwnerRateLimiter(
    LIMITS.jobCreateRateLimit.hits,
    LIMITS.jobCreateRateLimit.windowMs,
    () => now().getTime(),
  );
  const uploadLimiter = new OwnerRateLimiter(
    UPLOAD_LIMITS.rateLimit.hits,
    UPLOAD_LIMITS.rateLimit.windowMs,
    () => now().getTime(),
  );
  const sweep = (): Promise<SweepResult> => runSweep({ db: handle.db, store, now, log });
  const sweepQuietly = (): void => {
    sweep().catch((err) => log.error(`[sweep] failed: ${String(err)}`));
  };
  let stopSweep: (() => void) | undefined;

  return {
    config,
    handle,
    db: handle.db,
    ctx,
    worker,
    jobs: new JobService({ ctx, worker, limiter }),
    limiter,
    uploadLimiter,
    backup: createAppBackup(config, handle),
    heartbeatMs: options.heartbeatMs ?? 15_000,
    systemCacheMs: options.systemCacheMs ?? 3_000,
    sweep,
    async start() {
      await ctx.registry.refresh();
      await recoverInterruptedJobs(ctx);
      worker.start();
      sweepQuietly();
      stopSweep = scheduleEvery(DAY_MS, sweepQuietly);
    },
    async stop() {
      stopSweep?.();
      await worker.stop();
      handle.client.close();
    },
  };
}
