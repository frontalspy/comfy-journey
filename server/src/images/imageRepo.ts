import type { AppImage, ImageListQuery, ImagePage } from "@comfy/shared";
import { and, count, desc, eq, lt, or, type SQL, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { images, jobs } from "../db/schema.js";

export type ImageRow = typeof images.$inferSelect;
export type NewImageRow = typeof images.$inferInsert;

/** An image row with the job values it was made from. */
export interface ImageRecord {
  row: ImageRow;
  /** Null for an upload, which no job made. */
  workflowId: string | null;
  params: Record<string, unknown> | null;
}

/** What an upload's DTO reports as its workflow: it has none. */
export const UPLOAD_WORKFLOW_ID = "upload";

export function toImageDto(record: ImageRecord): AppImage {
  const { row } = record;
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind === "video" ? "video" : "image",
    source: row.source === "upload" ? "upload" : "generated",
    width: row.width,
    height: row.height,
    mime: row.mime,
    bytes: row.bytes,
    seed: row.seed,
    nsfw: row.nsfw,
    favourite: row.favourite,
    parentImageId: row.parentImageId,
    createdAt: row.createdAt,
    promptSummary: row.promptSummary,
    workflowId: record.workflowId ?? UPLOAD_WORKFLOW_ID,
    params: record.params ?? {},
    hasThumb: row.thumbKey !== null,
  };
}

const recordColumns = { row: images, workflowId: jobs.workflowId, params: jobs.params };

/** Every query here filters by owner at the query layer; a foreign id is simply "not found". */
export async function getOwnedImage(
  db: AppDatabase,
  ownerId: string,
  id: string,
): Promise<ImageRecord | undefined> {
  const [found] = await db
    .select(recordColumns)
    .from(images)
    .leftJoin(jobs, eq(jobs.id, images.jobId))
    .where(and(eq(images.id, id), eq(images.ownerId, ownerId)))
    .limit(1);
  return found;
}

export async function insertImage(db: AppDatabase, row: NewImageRow): Promise<void> {
  await db.insert(images).values(row);
}

export async function imageIdsForJob(db: AppDatabase, jobId: string): Promise<string[]> {
  const rows = await db
    .select({ id: images.id })
    .from(images)
    .where(eq(images.jobId, jobId))
    .orderBy(images.createdAt, sql`rowid`);
  return rows.map((r) => r.id);
}

function encodeCursor(row: ImageRow): string {
  return Buffer.from(`${row.createdAt}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | undefined {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return createdAt && id ? { createdAt, id } : undefined;
}

function escapeLike(term: string): string {
  return term.replace(/[|%_]/g, (char) => `|${char}`);
}

function filtersFor(ownerId: string, query: ImageListQuery): SQL[] {
  // Uploads are references, not results: only an explicit source=upload lists them.
  const conditions: SQL[] = [eq(images.ownerId, ownerId), eq(images.source, query.source)];
  if (query.kind) conditions.push(eq(images.kind, query.kind));
  if (query.favourite) conditions.push(eq(images.favourite, query.favourite === "true"));
  if (query.nsfw) conditions.push(eq(images.nsfw, query.nsfw === "true"));
  if (query.workflowId) conditions.push(eq(jobs.workflowId, query.workflowId));
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(sql`${images.promptSummary} like ${pattern} escape '|'`);
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  if (cursor) {
    const older = or(
      lt(images.createdAt, cursor.createdAt),
      and(eq(images.createdAt, cursor.createdAt), lt(images.id, cursor.id)),
    );
    if (older) conditions.push(older);
  }
  return conditions;
}

/** Newest first, cursor paged. */
export async function listOwnedImages(
  db: AppDatabase,
  ownerId: string,
  query: ImageListQuery,
): Promise<ImagePage> {
  const found = await db
    .select(recordColumns)
    .from(images)
    .leftJoin(jobs, eq(jobs.id, images.jobId))
    .where(and(...filtersFor(ownerId, query)))
    .orderBy(desc(images.createdAt), desc(images.id))
    .limit(query.limit + 1);
  const page = found.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toImageDto),
    nextCursor: found.length > query.limit && last ? encodeCursor(last.row) : null,
  };
}

export async function updateOwnedImage(
  db: AppDatabase,
  ownerId: string,
  id: string,
  patch: { favourite?: boolean; nsfw?: boolean },
): Promise<boolean> {
  if (patch.favourite === undefined && patch.nsfw === undefined) {
    return (await getOwnedImage(db, ownerId, id)) !== undefined;
  }
  const updated = await db
    .update(images)
    .set(patch)
    .where(and(eq(images.id, id), eq(images.ownerId, ownerId)))
    .returning({ id: images.id });
  return updated.length > 0;
}

/**
 * A finished job whose last image is gone is just an empty card, so it goes too. One guarded
 * statement: it only matches a done job of this owner with no image rows left, so two deletes of
 * the final two images (in either order) both succeed and exactly one of them removes the job.
 * Queued and running jobs, and uploads (which have no job), are never touched.
 */
async function deleteJobIfEmpty(db: AppDatabase, ownerId: string, jobId: string): Promise<void> {
  await db
    .delete(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.ownerId, ownerId),
        eq(jobs.status, "done"),
        sql`not exists (select 1 from images where images.job_id = ${jobs.id})`,
      ),
    );
}

/**
 * Deletes the row (and clears lineage pointers at it, and the job once it has no images left)
 * and returns it so the caller can remove files.
 */
export async function deleteOwnedImageRow(
  db: AppDatabase,
  ownerId: string,
  id: string,
): Promise<ImageRow | undefined> {
  const [deleted] = await db
    .delete(images)
    .where(and(eq(images.id, id), eq(images.ownerId, ownerId)))
    .returning();
  if (deleted) {
    await db.update(images).set({ parentImageId: null }).where(eq(images.parentImageId, id));
    if (deleted.jobId) await deleteJobIfEmpty(db, ownerId, deleted.jobId);
  }
  return deleted;
}

/** How many uploads the owner holds, for the per-owner cap. */
export async function countOwnedUploads(db: AppDatabase, ownerId: string): Promise<number> {
  const [found] = await db
    .select({ total: count() })
    .from(images)
    .where(and(eq(images.ownerId, ownerId), eq(images.source, "upload")));
  return found?.total ?? 0;
}
