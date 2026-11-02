import { readStored, writeStored } from "../../storage";

/** What the browser knows about a job beyond the server's job row: what was asked for. */
export interface JobMeta {
  workflowId: string;
  prompt: string;
  values: Record<string, unknown>;
}

const KEY = "comfy.jobMeta";
const MAX_ENTRIES = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(raw: unknown): Record<string, JobMeta> | undefined {
  if (!isRecord(raw)) return undefined;
  const result: Record<string, JobMeta> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (
      isRecord(entry) &&
      typeof entry.workflowId === "string" &&
      typeof entry.prompt === "string" &&
      isRecord(entry.values)
    ) {
      result[id] = { workflowId: entry.workflowId, prompt: entry.prompt, values: entry.values };
    }
  }
  return result;
}

export function readJobMeta(): Record<string, JobMeta> {
  return readStored(KEY, validate) ?? {};
}

/** Remembers a job's request, dropping the oldest entries past a small cap. */
export function rememberJob(jobId: string, meta: JobMeta): void {
  const all = readJobMeta();
  all[jobId] = meta;
  const keys = Object.keys(all);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[stale];
  writeStored(KEY, all);
}
