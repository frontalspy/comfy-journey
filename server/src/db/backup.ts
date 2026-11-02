import type { AppConfig } from "../config.js";
import { type BackupService, createBackup } from "../core/kit/index.js";
import { type AppDbHandle, databasePath } from "./client.js";

/**
 * Pruning is scoped by this prefix and data/backups/ may be shared with other services, so it is
 * required by createBackup and must stay unique to this app. Media is deliberately not backed up
 * (large, regenerable from params and seed).
 */
export const BACKUP_PREFIX = "comfy";

export function createAppBackup(config: AppConfig, handle: AppDbHandle): BackupService {
  return createBackup({
    prefix: BACKUP_PREFIX,
    dbClient: handle.client,
    dbPath: databasePath(config.dataDir),
    backupDir: config.backupDir,
    retention: config.backupRetention,
    intervalDays: config.backupIntervalDays,
  });
}
