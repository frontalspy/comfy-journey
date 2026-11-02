import type { AppEnv } from "./env.js";
import type { S3Config } from "./storage/s3MediaBackend.js";

/** Everything the services need, explicit so tests build them without touching process.env. */
export interface AppConfig {
  dataDir: string;
  comfyUrl: string;
  workflowsDir: string;
  /** Bearer secret for ComfyUI's job cleanup route; absent means finished files are left in place. */
  comfyCleanupToken?: string;
  allowNsfwWorkflows: boolean;
  /** Where media lives; absent means disk. */
  mediaStore?: "disk" | "s3";
  /** Present when mediaStore is "s3". */
  s3?: S3Config;
  backupDir?: string;
  backupRetention?: string;
  backupIntervalDays?: string;
}

export function configFromEnv(env: AppEnv): AppConfig {
  return {
    dataDir: env.DATA_DIR,
    comfyUrl: env.COMFYUI_URL,
    workflowsDir: env.WORKFLOWS_DIR,
    comfyCleanupToken: env.COMFYUI_CLEANUP_TOKEN?.trim() || undefined,
    allowNsfwWorkflows: env.ALLOW_NSFW_WORKFLOWS,
    mediaStore: env.MEDIA_STORE,
    s3:
      env.MEDIA_STORE === "s3" && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            bucket: env.S3_BUCKET,
            region: env.S3_REGION,
            endpoint: env.S3_ENDPOINT,
            prefix: env.S3_PREFIX,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
    backupDir: env.BACKUP_DIR,
    backupRetention: env.BACKUP_RETENTION,
    backupIntervalDays: env.BACKUP_INTERVAL_DAYS,
  };
}
