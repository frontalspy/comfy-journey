import { and, inArray, lt, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { images, jobs } from "../db/schema.js";
import type { MediaStore } from "./mediaStore.js";

export const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A file this young may be mid-write (the row is inserted just after); never treat it as orphaned. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

export interface SweepOptions {
  db: AppDatabase;
  store: MediaStore;
  now: () => Date;
  graceMs?: number;
  retentionDays?: number;
  log?: Pick<Console, "log" | "warn">;
}

export interface SweepResult {
  jobsRemoved: number;
  filesRemoved: number;
  mediaBytes: number;
}

const DELETE_CHUNK = 500;

/**
 * Deletes the jobs (their image rows cascade) and then the objects those rows named, so the
 * rows are gone before any object is. Returns how many objects were removed.
 */
async function deleteJobsAndFiles(
  db: AppDatabase,
  store: MediaStore,
  jobIds: string[],
): Promise<number> {
  let removed = 0;
  for (let start = 0; start < jobIds.length; start += DELETE_CHUNK) {
    const chunk = jobIds.slice(start, start + DELETE_CHUNK);
    const stale = await db
      .select({ fileKey: images.fileKey, thumbKey: images.thumbKey })
      .from(images)
      .where(inArray(images.jobId, chunk));
    await db.delete(jobs).where(inArray(jobs.id, chunk));
    for (const row of stale) {
      await store.remove("media", row.fileKey);
      await store.remove("thumbs", row.thumbKey);
      removed += row.thumbKey ? 2 : 1;
    }
  }
  return removed;
}

/**
 * Failed and cancelled jobs older than a week go, for every user (done jobs stay with their
 * images). Then, on disk only, any file that no image row points at goes too. Run daily and at boot.
 */
export async function runSweep(options: SweepOptions): Promise<SweepResult> {
  const { db, store, now } = options;
  const cutoff = new Date(now().getTime() - (options.retentionDays ?? RETENTION_DAYS) * DAY_MS);
  const removed = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["failed", "cancelled"]),
        lt(sql`coalesce(${jobs.finishedAt}, ${jobs.createdAt})`, cutoff.toISOString()),
      ),
    );
  let filesRemoved = await deleteJobsAndFiles(
    db,
    store,
    removed.map((job) => job.id),
  );

  const rows = await db
    .select({ fileKey: images.fileKey, thumbKey: images.thumbKey, bytes: images.bytes })
    .from(images);
  const referenced = {
    media: new Set(rows.map((row) => row.fileKey)),
    thumbs: new Set(rows.flatMap((row) => (row.thumbKey ? [row.thumbKey] : []))),
  };
  const grace = options.graceMs ?? ORPHAN_GRACE_MS;
  const stored = await store.list();
  if (!stored) {
    options.log?.log(
      "[sweep] orphan sweep skipped: the S3 backend cannot list objects (retention sweep still deletes their objects)",
    );
  }
  for (const file of stored ?? []) {
    if (referenced[file.area].has(file.key)) continue;
    if (now().getTime() - file.modifiedMs < grace) continue;
    await store.remove(file.area, file.key);
    filesRemoved += 1;
  }
  const mediaBytes = rows.reduce((total, row) => total + row.bytes, 0);
  options.log?.log(
    `[sweep] removed ${removed.length} old jobs and ${filesRemoved} orphan files; ${rows.length} items, ${mediaBytes} bytes of media`,
  );
  return { jobsRemoved: removed.length, filesRemoved, mediaBytes };
}
