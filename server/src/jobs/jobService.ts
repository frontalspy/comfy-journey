import { randomUUID } from "node:crypto";
import type { CreateJobRequest, Job, JobStatus, WorkflowKind } from "@comfy/shared";
import { BadRequestError, ConflictError, HttpError, NotFoundError } from "../core/kit/index.js";
import type { AppDatabase } from "../db/client.js";
import { getOwnedImage } from "../images/imageRepo.js";
import { LIMITS } from "../limits.js";
import type { WorkflowRegistry } from "../workflows/registry.js";
import { buildValuesSchema } from "../workflows/valuesSchema.js";
import type { JobContext } from "./jobContext.js";
import {
  cancelQueuedJob,
  countWaitingJobs,
  getJobById,
  getOwnedJob,
  insertJob,
  isTerminal,
  listOwnedJobs,
  toJobDto,
} from "./jobRepo.js";
import { markCancelled } from "./jobState.js";
import type { OwnerRateLimiter } from "./rateLimiter.js";
import type { JobWorker } from "./worker.js";

export type DerivedAction = "variation" | "upscale" | "animate";

/** Which workflow kind each follow-up action may use. */
export const KINDS_FOR_ACTION: Readonly<Record<DerivedAction, readonly WorkflowKind[]>> = {
  variation: ["img2img"],
  upscale: ["upscale"],
  animate: ["i2v"],
};

export interface JobServiceDeps {
  ctx: JobContext;
  worker: JobWorker;
  limiter: OwnerRateLimiter;
}

/** Validation, caps and the cancel protocol. Routes call this; they never touch rows directly. */
export class JobService {
  constructor(private readonly deps: JobServiceDeps) {}

  private get db(): AppDatabase {
    return this.deps.ctx.db;
  }

  private get registry(): WorkflowRegistry {
    return this.deps.ctx.registry;
  }

  /** Tail of each owner's in-flight creations, so the waiting-cap check and insert cannot interleave. */
  private readonly creating = new Map<string, Promise<unknown>>();

  async createJob(
    ownerId: string,
    request: CreateJobRequest,
    derived?: { action: DerivedAction; sourceImageId: string },
  ): Promise<Job> {
    const previous = this.creating.get(ownerId) ?? Promise.resolve();
    const run = previous.then(() => this.createJobUnlocked(ownerId, request, derived));
    const tail = run.catch(() => undefined);
    this.creating.set(ownerId, tail);
    void tail.then(() => {
      if (this.creating.get(ownerId) === tail) this.creating.delete(ownerId);
    });
    return run;
  }

  private async createJobUnlocked(
    ownerId: string,
    request: CreateJobRequest,
    derived?: { action: DerivedAction; sourceImageId: string },
  ): Promise<Job> {
    const workflow = this.registry.get(request.workflowId);
    if (!workflow) throw new BadRequestError("Unknown workflow");
    if (!workflow.available) throw new ConflictError("This workflow is not available right now");
    const { manifest } = workflow.loaded;
    if (derived && !KINDS_FOR_ACTION[derived.action].includes(manifest.kind)) {
      throw new BadRequestError(`This workflow cannot be used to ${derived.action} an image`);
    }

    const rawValues = { ...request.values };
    const imageParams = manifest.params.filter((param) => param.type === "image");
    if (derived) {
      const target = imageParams[0];
      if (!target) throw new BadRequestError("This workflow does not take an input image");
      rawValues[target.id] = derived.sourceImageId;
    }
    const parsed = buildValuesSchema(manifest).safeParse(rawValues);
    if (!parsed.success) {
      throw new BadRequestError(
        "Invalid values",
        parsed.error.issues.map((i) => `${i.path.join(".") || "values"}: ${i.message}`),
      );
    }
    // A missing id and someone else's id get the same 400, so the message never reveals which
    // exists (a stored image id is a UUID; the 404 convention applies to routes addressing a row).
    let sourceImageId: string | null = null;
    for (const param of manifest.params) {
      if (param.type !== "image" && param.type !== "images") continue;
      const value = parsed.data[param.id];
      const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      for (const imageId of ids) {
        const source =
          typeof imageId === "string" ? await getOwnedImage(this.db, ownerId, imageId) : undefined;
        if (source?.row.kind !== "image") {
          throw new BadRequestError(`${param.label}: choose one of your images`);
        }
        sourceImageId ??= imageId as string;
      }
    }

    if (!this.deps.limiter.tryHit(ownerId)) {
      throw new HttpError(429, "You are creating jobs too quickly. Try again in a minute.");
    }
    if ((await countWaitingJobs(this.db, ownerId)) >= LIMITS.maxWaitingJobsPerOwner) {
      throw new HttpError(429, "You already have the maximum number of waiting jobs.");
    }

    const row = {
      id: randomUUID(),
      ownerId,
      workflowId: manifest.id,
      workflowHash: workflow.loaded.hash,
      params: parsed.data,
      status: "queued" as const,
      sourceImageId,
      createdAt: this.deps.ctx.now().toISOString(),
    };
    await insertJob(this.db, row);
    this.deps.worker.wake();
    const created = await getJobById(this.db, row.id);
    if (!created) throw new Error("Job vanished after insert");
    return toJobDto(this.db, created);
  }

  async getJob(ownerId: string, id: string): Promise<Job> {
    const row = await getOwnedJob(this.db, ownerId, id);
    if (!row) throw new NotFoundError("Job not found");
    return toJobDto(this.db, row);
  }

  async listJobs(ownerId: string, status?: JobStatus, limit = 100): Promise<Job[]> {
    const rows = await listOwnedJobs(this.db, ownerId, { status, limit });
    return Promise.all(rows.map((row) => toJobDto(this.db, row)));
  }

  /** Queued jobs are cancelled directly; a claimed one is stopped through the worker. */
  async cancelJob(ownerId: string, id: string): Promise<Job> {
    const first = await getOwnedJob(this.db, ownerId, id);
    if (!first) throw new NotFoundError("Job not found");
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await getOwnedJob(this.db, ownerId, id);
      if (!row || isTerminal(row.status)) break;
      const { ctx, worker } = this.deps;
      if (row.status === "queued") {
        const finishedAt = ctx.now().toISOString();
        if (await cancelQueuedJob(this.db, ownerId, id, finishedAt)) {
          ctx.bus.publish({ type: "status", jobId: id, status: "cancelled" });
          break;
        }
        continue;
      }
      if (await worker.cancel(id)) break;
      // Claimed but not (yet or any longer) held by the worker: let it settle, then take over.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (attempt === 2) {
        const stuck = await getOwnedJob(this.db, ownerId, id);
        if (stuck && !isTerminal(stuck.status)) await markCancelled(ctx, id);
      }
    }
    return this.getJob(ownerId, id);
  }
}
