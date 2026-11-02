import { randomUUID } from "node:crypto";
import type { ComfyFileRef } from "../comfy/types.js";
import { getOwnedImage, type ImageRecord } from "../images/imageRepo.js";
import { UPLOAD_LIMITS } from "../images/uploadLimits.js";
import { LIMITS } from "../limits.js";
import { describeMime } from "../storage/mime.js";
import type { LoadedWorkflow } from "../workflows/loader.js";
import type { ResolvedImage } from "../workflows/resolvedImages.js";
import type { JobContext } from "./jobContext.js";
import { JobFailure, MESSAGES } from "./jobFailure.js";
import type { JobRow } from "./jobRepo.js";

interface StoredInput {
  record: ImageRecord;
  ext: string;
}

async function load(ctx: JobContext, ownerId: string, imageId: unknown): Promise<StoredInput> {
  // The owner filter is in the query: someone else's image is simply "not there".
  const record =
    typeof imageId === "string" ? await getOwnedImage(ctx.db, ownerId, imageId) : undefined;
  const ext = record ? describeMime(record.row.mime)?.ext : undefined;
  if (record?.row.kind !== "image" || !ext) throw new JobFailure(MESSAGES.noSource);
  return { record, ext };
}

async function sendToComfy(
  ctx: JobContext,
  stored: StoredInput,
  subfolder: string | undefined,
  staged: ComfyFileRef[] | undefined,
): Promise<{ file: string; name: string }> {
  const { row } = stored.record;
  // Any read failure (missing object, R2 outage, oversize) is the same "input is gone" to the user.
  const bytes = await ctx.store
    .read("media", row.fileKey, LIMITS.maxImageInputBytes)
    .catch(() => undefined);
  if (!bytes) throw new JobFailure(MESSAGES.noSource);
  const uploaded = await ctx.comfy.uploadImage({
    bytes,
    filename: `comfy-${randomUUID()}.${stored.ext}`,
    mime: row.mime,
    subfolder,
  });
  const folder = uploaded.subfolder || subfolder || "";
  staged?.push({ filename: uploaded.name, subfolder: folder, type: "input" });
  return { file: folder ? `${folder}/${uploaded.name}` : uploaded.name, name: uploaded.name };
}

/**
 * Turns the stored image ids in a job's values into what the graph needs: an `image` parameter
 * becomes the ComfyUI file name it was uploaded under, an `images` parameter a ResolvedImage list.
 * Every id is re-checked against the job owner here (a worker never trusts the stored snapshot),
 * the combined size is capped before anything is read or sent, and ComfyUI only ever sees
 * server-generated file names. The ids themselves stay in `job.params` for the snapshot. Every file
 * sent to ComfyUI is appended to `staged` so the runner can clean it up when the job ends.
 */
export async function resolveInputs(
  ctx: JobContext,
  job: JobRow,
  loaded: LoadedWorkflow,
  staged?: ComfyFileRef[],
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = { ...job.params };
  const single = new Map<string, StoredInput>();
  const lists = new Map<string, StoredInput[]>();
  let totalBytes = 0;

  for (const param of loaded.manifest.params) {
    const value = values[param.id];
    if (param.type === "image" && typeof value === "string") {
      single.set(param.id, await load(ctx, job.ownerId, value));
    } else if (param.type === "images" && Array.isArray(value)) {
      const items: StoredInput[] = [];
      for (const imageId of value) items.push(await load(ctx, job.ownerId, imageId));
      lists.set(param.id, items);
    }
  }
  for (const stored of [...single.values(), ...[...lists.values()].flat()]) {
    totalBytes += stored.record.row.bytes;
  }
  if (totalBytes > UPLOAD_LIMITS.maxJobInputBytes) throw new JobFailure(MESSAGES.inputsTooLarge);

  for (const param of loaded.manifest.params) {
    const one = single.get(param.id);
    if (one) values[param.id] = (await sendToComfy(ctx, one, undefined, staged)).file;
    const many = lists.get(param.id);
    if (many && param.type === "images") {
      const resolved: ResolvedImage[] = [];
      for (const [index, stored] of many.entries()) {
        const sent = await sendToComfy(ctx, stored, param.uploadSubfolder, staged);
        const { row } = stored.record;
        resolved.push({
          file: sent.file,
          name: row.source === "upload" ? row.promptSummary || sent.name : `image-${index + 1}`,
          width: row.width,
          height: row.height,
        });
      }
      values[param.id] = resolved;
    }
  }
  return values;
}
