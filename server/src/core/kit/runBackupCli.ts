import type { BackupService } from "./backup.js";

export interface RunBackupCliOptions {
  exit?: (code: number) => void;
  log?: Pick<Console, "log" | "error">;
}

/** The body of a service's `db:backup` script: one snapshot, then exit 0 (or 1 on failure). */
export async function runBackupCli(
  backup: Pick<BackupService, "run">,
  options: RunBackupCliOptions = {},
): Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? console;
  try {
    const backupPath = await backup.run();
    log.log(`Backup written to ${backupPath}`);
    exit(0);
  } catch (err) {
    log.error(err);
    exit(1);
  }
}
