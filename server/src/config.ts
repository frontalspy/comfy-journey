import type { AppEnv } from "./env.js";

/** Everything the services need, explicit so tests build them without touching process.env. */
export interface AppConfig {
  dataDir: string;
  comfyUrl: string;
  workflowsDir: string;
  /** Bearer secret for ComfyUI's job cleanup route; absent means finished files are left in place. */
  comfyCleanupToken?: string;
  allowNsfwWorkflows: boolean;
  /** Where media lives; absent means disk. */
  mediaStore?: "disk";
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
    backupDir: env.BACKUP_DIR,
    backupRetention: env.BACKUP_RETENTION,
    backupIntervalDays: env.BACKUP_INTERVAL_DAYS,
  };
}
