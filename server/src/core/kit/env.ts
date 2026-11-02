import { z } from "zod";

/**
 * The environment every service of the app shares. Backup settings stay strings here and get their
 * defaults in `createBackup`, so an unset value and a nonsense value fall back the same way.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.string().optional(),
  HOST: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  BACKUP_RETENTION: z.string().optional(),
  BACKUP_INTERVAL_DAYS: z.string().optional(),
  RUN_BACKUP_SCHEDULER: z.string().optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
