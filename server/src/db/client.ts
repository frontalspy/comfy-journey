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
  const handle = await openSqlite({ path: databasePath(dataDir), schema });
  await runMigrations(handle.db, MIGRATIONS_FOLDER);
  return handle;
}
