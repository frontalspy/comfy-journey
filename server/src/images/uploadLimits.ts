/** Ceilings for reference uploads (POST /api/uploads). Kept apart from workflow LIMITS on purpose. */
export const UPLOAD_LIMITS = {
  /** Uploads one owner may hold at once; delete some to add more. */
  maxUploadsPerOwner: 200,
  /** POST /api/uploads per owner per window. */
  rateLimit: { hits: 20, windowMs: 60_000 },
  /** Decoded width times height. Anything larger is refused before it is decoded. */
  maxPixels: 16_000_000,
  /** Longest stored file name kept as the upload's label. */
  maxNameLength: 120,
  /** Combined bytes of the stored inputs one job may send to ComfyUI. */
  maxJobInputBytes: 120 * 1024 * 1024,
} as const;
