import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { collectOutputFiles } from "../comfy/client.js";
import { ComfyError } from "../comfy/errors.js";
import type { ComfyFileRef, ComfyHistoryEntry } from "../comfy/types.js";
import { images } from "../db/schema.js";
import { insertImage } from "../images/imageRepo.js";
import { describeFilename } from "../storage/mime.js";
import { describeImage } from "../storage/thumbnails.js";
import type { LoadedWorkflow } from "../workflows/loader.js";
import { cleanupComfyFiles } from "./comfyCleanup.js";
import type { JobContext } from "./jobContext.js";
import { JobFailure, MESSAGES } from "./jobFailure.js";
import type { JobRow } from "./jobRepo.js";
import { updateJob } from "./jobState.js";

const SUMMARY_LENGTH = 200;

/** A preview that ComfyUI already cleaned up is skipped; any other failure fails the job. */
async function fetchOrSkip(ctx: JobContext, ref: ComfyFileRef) {
  try {
    return await ctx.comfy.fetchOutput(ref);
  } catch (err) {
    if (ref.type !== "output" && err instanceof ComfyError && err.status === 404) return undefined;
    throw err;
  }
}

function promptSummary(loaded: LoadedWorkflow, values: Record<string, unknown>): string {
  const texts = loaded.manifest.params.filter((param) => param.type === "text");
  const main = texts.find((param) => param.id === "prompt") ?? texts[0];
  const value = main ? values[main.id] : undefined;
  return typeof value === "string" ? value.trim().slice(0, SUMMARY_LENGTH) : "";
}

function seedOf(loaded: LoadedWorkflow, values: Record<string, unknown>): number | null {
  const param = loaded.manifest.params.find((p) => p.type === "seed");
  const value = param ? values[param.id] : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Removes rows and files a crashed earlier attempt left for this job, so a retry never duplicates. */
async function clearJobOutputs(ctx: JobContext, jobId: string): Promise<void> {
  const stale = await ctx.db.select().from(images).where(eq(images.jobId, jobId));
  if (stale.length === 0) return;
  await ctx.db.delete(images).where(eq(images.jobId, jobId));
  for (const row of stale) {
    await ctx.store.remove("media", row.fileKey);
    await ctx.store.remove("thumbs", row.thumbKey);
  }
}

/**
 * Pulls every output of a finished run from ComfyUI, stores it with a thumbnail, inserts the
 * image rows and marks the job done, then asks ComfyUI to delete its own copies (best effort).
 * Failing part-way removes what was written and leaves ComfyUI's files alone.
 */
export async function storeJobOutputs(
  ctx: JobContext,
  job: JobRow,
  loaded: LoadedWorkflow,
  entry: ComfyHistoryEntry,
): Promise<void> {
  if (entry.statusStr === "error") throw new JobFailure(MESSAGES.failed);
  const refs = collectOutputFiles(entry);
  await clearJobOutputs(ctx, job.id);
  const imageIds: string[] = [];
  const keys: { media: string; thumb: string | null }[] = [];
  try {
    for (const ref of refs) {
      const described = describeFilename(ref.filename);
      if (!described) continue;
      const output = await fetchOrSkip(ctx, ref);
      if (!output) continue;
      const facts =
        described.kind === "image"
          ? await describeImage(output.bytes)
          : { width: null, height: null, thumbnail: null };
      // Objects first, rows after; the entry is tracked as soon as its media exists so a failing
      // thumbnail put still cleans the media up.
      const written: { media: string; thumb: string | null } = {
        media: await ctx.store.write("media", job.ownerId, output.bytes, described.ext),
        thumb: null,
      };
      keys.push(written);
      if (facts.thumbnail) {
        written.thumb = await ctx.store.write("thumbs", job.ownerId, facts.thumbnail, "webp");
      }
      const id = randomUUID();
      await insertImage(ctx.db, {
        id,
        jobId: job.id,
        ownerId: job.ownerId,
        kind: described.kind,
        source: "generated",
        fileKey: written.media,
        thumbKey: written.thumb,
        width: facts.width,
        height: facts.height,
        mime: described.mime,
        bytes: output.bytes.byteLength,
        seed: seedOf(loaded, job.params),
        nsfw: loaded.manifest.nsfw,
        parentImageId: job.sourceImageId,
        promptSummary: promptSummary(loaded, job.params),
        createdAt: ctx.now().toISOString(),
      });
      imageIds.push(id);
      ctx.bus.publish({ type: "image", jobId: job.id, imageId: id });
    }
    if (imageIds.length === 0) throw new JobFailure(MESSAGES.noOutput);
  } catch (err) {
    await ctx.db.delete(images).where(eq(images.jobId, job.id));
    for (const key of keys) {
      await ctx.store.remove("media", key.media);
      await ctx.store.remove("thumbs", key.thumb);
    }
    throw err;
  }
  await updateJob(
    ctx,
    job.id,
    { status: "done", progress: 1, error: null, finishedAt: ctx.now().toISOString() },
    [{ type: "done", jobId: job.id, imageIds }],
  );
  // Only now, with media stored and rows committed, are ComfyUI's copies disposable.
  await cleanupComfyFiles(ctx, job.id, refs);
}
