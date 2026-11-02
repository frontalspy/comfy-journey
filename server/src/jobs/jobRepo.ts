import { type Job, type JobStatus, TERMINAL_JOB_STATUSES } from "@comfy/shared";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { imageIdsForJob } from "../images/imageRepo.js";

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type JobPatch = Partial<Omit<JobRow, "id" | "ownerId" | "createdAt">>;

const WAITING: JobStatus[] = ["queued", "waiting_for_gpu"];

export function isTerminal(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export async function toJobDto(db: AppDatabase, row: JobRow): Promise<Job> {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status as JobStatus,
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    imageIds: await imageIdsForJob(db, row.id),
  };
}

export async function insertJob(db: AppDatabase, row: NewJobRow): Promise<void> {
  await db.insert(jobs).values(row);
}

/** Owner-scoped read: someone else's job is indistinguishable from a missing one. */
export async function getOwnedJob(
  db: AppDatabase,
  ownerId: string,
  id: string,
): Promise<JobRow | undefined> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.ownerId, ownerId)))
    .limit(1);
  return row;
}

/** Worker-side read; never reachable from a route with a client-supplied owner. */
export async function getJobById(db: AppDatabase, id: string): Promise<JobRow | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row;
}

export async function listOwnedJobs(
  db: AppDatabase,
  ownerId: string,
  options: { status?: JobStatus; limit: number },
): Promise<JobRow[]> {
  const conditions = [eq(jobs.ownerId, ownerId)];
  if (options.status) conditions.push(eq(jobs.status, options.status));
  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt), sql`rowid desc`)
    .limit(options.limit);
}

export async function countWaitingJobs(db: AppDatabase, ownerId?: string): Promise<number> {
  const conditions = [inArray(jobs.status, WAITING)];
  if (ownerId) conditions.push(eq(jobs.ownerId, ownerId));
  const [row] = await db
    .select({ total: count() })
    .from(jobs)
    .where(and(...conditions));
  return row?.total ?? 0;
}

/** Atomically takes the oldest queued job (any owner) and marks it waiting for the GPU. */
export async function claimNextJob(db: AppDatabase): Promise<JobRow | undefined> {
  const [claimed] = await db
    .update(jobs)
    .set({ status: "waiting_for_gpu" })
    .where(
      sql`${jobs.id} = (select id from jobs where status = 'queued' order by created_at, rowid limit 1) and ${jobs.status} = 'queued'`,
    )
    .returning();
  return claimed;
}

export async function patchJob(db: AppDatabase, id: string, patch: JobPatch): Promise<void> {
  await db.update(jobs).set(patch).where(eq(jobs.id, id));
}

/** Queued -> cancelled in one guarded statement; false when the worker claimed it first. */
export async function cancelQueuedJob(
  db: AppDatabase,
  ownerId: string,
  id: string,
  finishedAt: string,
): Promise<boolean> {
  const updated = await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt })
    .where(and(eq(jobs.id, id), eq(jobs.ownerId, ownerId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

export async function jobsInStatus(db: AppDatabase, statuses: JobStatus[]): Promise<JobRow[]> {
  return db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, statuses))
    .orderBy(jobs.createdAt, sql`rowid`);
}
