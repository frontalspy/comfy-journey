import fs from "node:fs";
import path from "node:path";
import { newestSnapshotTime, pruneBackups } from "./backupPrune.js";
import { assertNotRealDataInTests } from "./realData.js";
import { scheduleRecurring } from "./scheduler.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_DAYS = 7;
const DEFAULT_RETENTION = 14;

/** A directory of uploaded files copied alongside each snapshot. */
export interface BackupUploadSource {
  dir: string;
  /** Subfolder inside the snapshot's `-uploads` directory. Omit to copy into its root. */
  subfolder?: string;
}

export interface BackupOptions {
  /**
   * Filename prefix for every snapshot this service writes, e.g. "builders-". REQUIRED, with no
   * default: both APIs share one backups directory, and pruning only ever touches files carrying
   * this prefix — a shared or empty prefix would let one service delete the other's backups.
   */
  prefix: string;
  /** Anything that can run `VACUUM INTO` — the libsql client from `openSqlite`. */
  dbClient: { execute(sql: string): Promise<unknown> };
  /** The live database file; the default backup directory is `backups/` beside it. */
  dbPath: string;
  backupDir?: string;
  /** Snapshots kept. Unset, non-numeric or non-positive falls back to 14. */
  retention?: string | number;
  /** Days between scheduled backups; fractional allowed. Invalid falls back to 7. */
  intervalDays?: string | number;
  uploads?: readonly BackupUploadSource[];
  log?: Pick<Console, "log" | "error">;
}

export interface BackupService {
  readonly prefix: string;
  readonly backupDir: string;
  readonly retention: number;
  readonly intervalDays: number;
  /** Writes one snapshot (plus uploads), prunes, and resolves to the snapshot's path. */
  run(): Promise<string>;
  /** Backs up now (unless the newest snapshot is under `intervalDays` old), then every `intervalDays`. Returns a function that stops the schedule. */
  startScheduler(): () => void;
}

function positiveNumberOr(raw: string | number | undefined, fallback: number): number {
  const parsed = Number(raw);
  return raw !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertValidPrefix(prefix: string): void {
  if (prefix.trim().length === 0 || /[/]/.test(prefix)) {
    throw new Error(`createBackup: prefix must be a non-empty filename fragment, got "${prefix}"`);
  }
}

/**
 * Copies each non-empty upload source into `<prefix><timestamp>-uploads/`. Image stores create
 * their directories eagerly, so "exists" isn't "has something to back up" — empty ones are
 * skipped so snapshots don't drag along pointless empty folders.
 */
function copyUploads(sources: readonly BackupUploadSource[], destRoot: string): void {
  for (const source of sources) {
    if (!fs.existsSync(source.dir) || fs.readdirSync(source.dir).length === 0) continue;
    const dest = source.subfolder ? path.join(destRoot, source.subfolder) : destRoot;
    fs.cpSync(source.dir, dest, { recursive: true });
  }
}

/**
 * SQLite snapshots via `VACUUM INTO`, a sibling copy of uploads, prefix-scoped pruning, and an
 * optional in-process schedule. See `BackupOptions.prefix` for why the prefix is required.
 */
export function createBackup(options: BackupOptions): BackupService {
  assertValidPrefix(options.prefix);
  const { prefix, dbClient } = options;
  const log = options.log ?? console;
  const backupDir = options.backupDir ?? path.resolve(path.dirname(options.dbPath), "backups");
  const retention = positiveNumberOr(options.retention, DEFAULT_RETENTION);
  const intervalDays = positiveNumberOr(options.intervalDays, DEFAULT_INTERVAL_DAYS);

  async function run(): Promise<string> {
    assertNotRealDataInTests("The backup directory", backupDir);
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `${prefix}${timestamp}.sqlite`);
    await dbClient.execute(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    copyUploads(options.uploads ?? [], path.join(backupDir, `${prefix}${timestamp}-uploads`));
    pruneBackups(backupDir, prefix, retention);
    return backupPath;
  }

  function runLogged(): void {
    run()
      .then((backupPath) => log.log(`Backup written to ${backupPath}`))
      .catch((err) => log.error("Backup failed:", err));
  }

  function startScheduler(): () => void {
    log.log(
      `Backup scheduler: every ${intervalDays} day(s), keeping the last ${retention} snapshots.`,
    );
    // A restart is not a reason to snapshot: with frequent restarts (deploys, crashes) startup
    // backups would push the real interval-spaced snapshots out of the retention window.
    const lastBackup = newestSnapshotTime(backupDir, prefix);
    const ageMs = lastBackup ? Date.now() - lastBackup.getTime() : Number.POSITIVE_INFINITY;
    if (ageMs >= intervalDays * DAY_MS) runLogged();
    else log.log(`Latest backup is ${Math.round(ageMs / 60000)} min old; skipping startup backup.`);
    return scheduleRecurring(intervalDays * DAY_MS, runLogged);
  }

  return { prefix, backupDir, retention, intervalDays, run, startScheduler };
}
