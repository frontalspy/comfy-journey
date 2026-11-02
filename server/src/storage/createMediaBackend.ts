import type { AppConfig } from "../config.js";
import { DiskMediaBackend } from "./diskMediaBackend.js";
import type { MediaBackend } from "./mediaBackend.js";

/** Disk is the only backend for now; an S3-compatible one is planned. */
export function createMediaBackend(
  config: Pick<AppConfig, "dataDir" | "mediaStore">,
): MediaBackend {
  return new DiskMediaBackend(config.dataDir);
}
