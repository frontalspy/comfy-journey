/** Global ceilings no workflow manifest can exceed. Enforced in buildValuesSchema. */
export const LIMITS = {
  maxPromptLength: 6000,
  maxBatch: 8,
  maxSteps: 80,
  /** Width times height, per image. */
  maxPixels: 2048 * 2048,
  maxDimension: 4096,
  maxFrames: 121,
  maxImageInputBytes: 20 * 1024 * 1024,
  /** Jobs a single owner may have queued or waiting for the GPU at once. */
  maxWaitingJobsPerOwner: 4,
  /** POST /api/jobs (and the derived routes) per owner per window. */
  jobCreateRateLimit: { hits: 12, windowMs: 60_000 },
} as const;
