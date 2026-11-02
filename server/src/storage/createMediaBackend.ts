import type { AppConfig } from "../config.js";
import { DiskMediaBackend } from "./diskMediaBackend.js";
import type { MediaBackend } from "./mediaBackend.js";
import { S3MediaBackend } from "./s3MediaBackend.js";

export function createMediaBackend(
  config: Pick<AppConfig, "dataDir" | "mediaStore" | "s3">,
): MediaBackend {
  if (config.mediaStore === "s3") {
    if (!config.s3) throw new Error("MEDIA_STORE=s3 needs the S3_* settings");
    return new S3MediaBackend(config.s3);
  }
  return new DiskMediaBackend(config.dataDir);
}
