import fs from "node:fs";
import path from "node:path";
import { openSqlite, runMigrations, type SqliteHandle } from "../core/kit/index.js";
import * as schema from "./schema.js";

export type AppSchema = typeof schema;
export type AppDatabase = SqliteHandle<AppSchema>["db"];
export type AppDbHandle = SqliteHandle<AppSchema>;

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "./migrations");

export function databasePath(dataDir: string): string {
  return path.join(dataDir, "comfy.sqlite");
}

/** Opens (creating the directory) and migrates the app's own SQLite file under `dataDir`. */
export async function openAppDb(dataDir: string): Promise<AppDbHandle> {
  fs.mkdirSync(dataDir, { recursive: true });
  assertWritable(dataDir);
  const handle = await openSqlite({ path: databasePath(dataDir), schema });
  await runMigrations(handle.db, MIGRATIONS_FOLDER);
  return handle;
}

/**
 * libsql reports an unwritable folder as "Unable to open connection to local database", which
 * names nothing to fix. Check first, so the message says what to do.
 */
function assertWritable(dataDir: string): void {
  try {
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    const user =
      typeof process.getuid === "function" ? ` (running as uid ${process.getuid()})` : "";
    throw new Error(
      `The data directory ${dataDir} is not writable${user}: ${code}. Give the service user ownership of it, e.g. chown -R <user> ${dataDir}, and make sure a systemd unit lists it in ReadWritePaths.`,
    );
  }
}
