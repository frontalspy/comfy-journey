import fs from "node:fs";
import path from "node:path";

const TIMESTAMP = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z";

function escapeRegExp(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
}

function newestFirst(names: string[]): string[] {
  return [...names].sort().reverse();
}

/**
 * Names of this service's snapshots, newest first. The name must be exactly
 * `<prefix><ISO timestamp>.sqlite`: matching on the bare prefix would let a service whose prefix
 * extends another's ("builders-" vs "builders-old-") count, and delete, the other's files.
 */
export function listSnapshots(backupDir: string, prefix: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  const pattern = new RegExp(`^${escapeRegExp(prefix)}${TIMESTAMP}[.]sqlite$`);
  const names = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isFile() && pattern.test(e.name))
    .map((e) => e.name);
  return newestFirst(names);
}

/** When the newest snapshot was taken (from its filename), or undefined if there is none. */
export function newestSnapshotTime(backupDir: string, prefix: string): Date | undefined {
  const newest = listSnapshots(backupDir, prefix)[0];
  if (!newest) return undefined;
  const stamp = newest.slice(prefix.length, -".sqlite".length);
  const time = new Date(stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z"));
  return Number.isNaN(time.getTime()) ? undefined : time;
}

function removeQuietly(target: string, remove: () => void): void {
  try {
    remove();
  } catch (err) {
    // A locked or already-gone old snapshot must not fail the backup that just succeeded.
    console.error(`Could not prune ${target}:`, err);
  }
}

/**
 * Deletes this service's snapshots (and their `-uploads` directories) beyond `retention`,
 * newest kept; at least one snapshot always survives.
 *
 * Filtering by `prefix` BEFORE counting is load-bearing: both APIs default to the same
 * `data/backups/` directory, and the prefix is the only thing keeping either service's
 * retention count, and its deletes, away from the other's files. The lexicographic sort is
 * chronological only because a fixed-width ISO timestamp follows a constant prefix.
 */
export function pruneBackups(backupDir: string, prefix: string, retention: number): void {
  const keep = Math.max(1, Math.floor(retention));
  for (const stale of listSnapshots(backupDir, prefix).slice(keep)) {
    removeQuietly(stale, () => fs.unlinkSync(path.join(backupDir, stale)));
  }

  const uploadsPattern = new RegExp(`^${escapeRegExp(prefix)}${TIMESTAMP}-uploads$`);
  const uploadCopies = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && uploadsPattern.test(e.name))
    .map((e) => e.name);
  for (const stale of newestFirst(uploadCopies).slice(keep)) {
    removeQuietly(stale, () =>
      fs.rmSync(path.join(backupDir, stale), { recursive: true, force: true }),
    );
  }
}
