import { ComfyError } from "../comfy/errors.js";
import type { ComfyFileRef } from "../comfy/types.js";
import type { JobContext } from "./jobContext.js";

/** The one input subfolder the app stages references into, and the only one the extension accepts. */
export const STAGED_INPUT_SUBFOLDER = "comfy";

function isCleanable(ref: ComfyFileRef): boolean {
  if (ref.type === "output" || ref.type === "temp") return true;
  return ref.type === "input" && ref.subfolder === STAGED_INPUT_SUBFOLDER;
}

/**
 * Best-effort removal of files ComfyUI wrote or received for a job. Does nothing without a
 * cleanup token. Any failure (extension missing, 401, timeout, ComfyUI down) is a warning with a
 * count and a status, never a file name, and never reaches the job: the caller has already
 * recorded the job's outcome.
 */
export async function cleanupComfyFiles(
  ctx: JobContext,
  jobId: string,
  files: ComfyFileRef[],
): Promise<void> {
  if (!ctx.comfy.cleanupEnabled) return;
  const cleanable = files.filter(isCleanable);
  if (cleanable.length === 0) return;
  try {
    const result = await ctx.comfy.deleteOutputs(cleanable);
    if (result.refused > 0) {
      ctx.log.warn(
        `[cleanup] job ${jobId}: ComfyUI refused ${result.refused} of ${cleanable.length} file(s)`,
      );
    }
  } catch (err) {
    const why =
      err instanceof ComfyError
        ? `${err.kind}${err.status ? ` ${err.status}` : ""}`
        : "unexpected error";
    ctx.log.warn(
      `[cleanup] job ${jobId}: could not clean ${cleanable.length} file(s) in ComfyUI (${why})`,
    );
  }
}
