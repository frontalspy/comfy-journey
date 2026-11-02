import { describeFilename } from "../storage/mime.js";
import { isRecord } from "./guards.js";
import type { ComfyFileRef, ComfyHistoryEntry } from "./types.js";

/** Most outputs one job keeps; a runaway graph cannot fill the disk. */
export const MAX_OUTPUTS_PER_JOB = 16;

const OUTPUT_TYPES = new Set(["output", "temp"]);

function isSafePart(value: string): boolean {
  return !value.includes("..") && !value.includes("\\") && !value.startsWith("/");
}

/**
 * File refs listed in a history entry's outputs, from every key of every node (`images`, `gifs`
 * from VHS_VideoCombine, `videos`, `audio`, ...). Each file's own `type` is kept because /view
 * must be asked for "temp" files (PreviewImage) as such. Non-media (audio, animated flags),
 * input-type refs and unsafe paths are dropped, duplicates collapse, and permanent "output" files
 * come ahead of "temp" previews (or replace them, with `previews: false`). Capped at MAX_OUTPUTS_PER_JOB.
 */
export function collectOutputFiles(
  entry: ComfyHistoryEntry,
  options: { previews?: boolean } = {},
): ComfyFileRef[] {
  const seen = new Set<string>();
  const refs: ComfyFileRef[] = [];
  for (const output of Object.values(entry.outputs)) {
    for (const list of Object.values(output)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!isRecord(item) || typeof item.filename !== "string") continue;
        const subfolder = typeof item.subfolder === "string" ? item.subfolder : "";
        const type = typeof item.type === "string" ? item.type : "output";
        if (!OUTPUT_TYPES.has(type) || !isSafePart(item.filename) || !isSafePart(subfolder))
          continue;
        if (!describeFilename(item.filename)) continue;
        const key = `${type}|${subfolder}|${item.filename}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ filename: item.filename, subfolder, type });
      }
    }
  }
  const permanent = refs.filter((ref) => ref.type === "output");
  const previews = refs.filter((ref) => ref.type !== "output");
  // previews: false drops temp files, but only when the run saved something to keep.
  const keep =
    options.previews === false && permanent.length > 0 ? permanent : [...permanent, ...previews];
  return keep.slice(0, MAX_OUTPUTS_PER_JOB);
}
