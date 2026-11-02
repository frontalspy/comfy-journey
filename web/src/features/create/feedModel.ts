import type { AppImage, Job } from "@comfy/shared";
import type { JobMeta } from "../jobs/jobMeta";

export interface FeedGroup {
  jobId: string;
  createdAt: string;
  job: Job | undefined;
  meta: JobMeta | undefined;
  /** Results so far, in the order they were produced. */
  images: AppImage[];
}

const ACTIVE = new Set<Job["status"]>(["queued", "waiting_for_gpu", "running"]);
const RECENT_FAILURE_MS = 24 * 60 * 60 * 1000;
/** After "done", the gallery refetch may lag the job list by a moment; keep the row until it lands. */
const SETTLE_MS = 2 * 60 * 1000;

export const isActive = (job: Job): boolean => ACTIVE.has(job.status);

function jobBelongsInFeed(job: Job, nowMs: number): boolean {
  const age = nowMs - Date.parse(job.createdAt);
  if (isActive(job)) return true;
  if (job.status === "done") return age < SETTLE_MS;
  return age < RECENT_FAILURE_MS; // failed or cancelled: show for a day so it can be retried
}

/**
 * Merges the live job list with the loaded gallery into rows, newest first. A finished job is
 * shown by its images; a job with no images yet (or that failed) is shown by its status.
 */
export function buildFeed(
  jobs: readonly Job[],
  images: readonly AppImage[],
  meta: Readonly<Record<string, JobMeta>>,
  nowMs: number,
): FeedGroup[] {
  const imagesByJob = new Map<string, AppImage[]>();
  for (const image of images) {
    if (!image.jobId) continue;
    const list = imagesByJob.get(image.jobId);
    if (list) list.push(image);
    else imagesByJob.set(image.jobId, [image]);
  }

  const groups = new Map<string, FeedGroup>();
  for (const [jobId, list] of imagesByJob) {
    const ordered = [...list].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const job = jobs.find((candidate) => candidate.id === jobId);
    groups.set(jobId, {
      jobId,
      createdAt: job?.createdAt ?? ordered[0]?.createdAt ?? "",
      job,
      meta: meta[jobId],
      images: ordered,
    });
  }

  for (const job of jobs) {
    if (groups.has(job.id) || !jobBelongsInFeed(job, nowMs)) continue;
    groups.set(job.id, {
      jobId: job.id,
      createdAt: job.createdAt,
      job,
      meta: meta[job.id],
      images: [],
    });
  }

  return [...groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many result slots a running job will fill, from what was asked for. */
export function expectedCount(meta: JobMeta | undefined): number {
  const batch = meta?.values.batch;
  return typeof batch === "number" && batch >= 1 ? Math.min(Math.floor(batch), 12) : 1;
}

/** The shape of the placeholder tiles, from the requested size. */
export function expectedRatio(meta: JobMeta | undefined): number {
  const width = meta?.values.width;
  const height = meta?.values.height;
  return typeof width === "number" && typeof height === "number" && height > 0 ? width / height : 1;
}
