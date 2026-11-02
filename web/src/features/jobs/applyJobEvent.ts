import type { Job, JobEvent } from "@comfy/shared";

export interface AppliedEvent {
  jobs: Job[];
  /** False when the event names a job this list has never seen (another tab made it). */
  known: boolean;
}

/** Folds one live event into the cached job list. Pure, so it is unit tested. */
export function applyJobEvent(jobs: readonly Job[], event: JobEvent): AppliedEvent {
  const index = jobs.findIndex((job) => job.id === event.jobId);
  const current = jobs[index];
  if (!current) return { jobs: [...jobs], known: false };

  const next = patchJob(current, event);
  if (next === current) return { jobs: [...jobs], known: true };
  const updated = [...jobs];
  updated[index] = next;
  return { jobs: updated, known: true };
}

function patchJob(job: Job, event: JobEvent): Job {
  switch (event.type) {
    case "status":
      return job.status === event.status ? job : { ...job, status: event.status };
    case "progress":
      return { ...job, progress: event.progress };
    case "image":
      return job.imageIds.includes(event.imageId)
        ? job
        : { ...job, imageIds: [...job.imageIds, event.imageId] };
    case "done":
      return { ...job, status: "done", progress: 1, imageIds: event.imageIds };
    case "error":
      return { ...job, status: "failed", error: event.message };
  }
}
