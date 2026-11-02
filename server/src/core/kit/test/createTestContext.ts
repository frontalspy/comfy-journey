import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { runMigrations } from "../migrations.js";
import { assertNotRealData, findRealDataDir } from "../realData.js";

// biome-ignore lint/suspicious/noExplicitAny: any drizzle schema; the caller's own type flows through TDb.
type AnyLibSQLDatabase = LibSQLDatabase<any>;

export interface TestDatabaseOptions<TDb extends AnyLibSQLDatabase> {
  /** Prefix for the throwaway files, e.g. "server-test". */
  runPrefix: string;
  /**
   * Pass vitest's `vi.resetModules`. A service's db module opens its connection on import and its
   * env module parses process.env once, so both must be re-imported after the env below is set
   * — and re-imported again on every call, or a second context reuses the first one's file.
   */
  resetModules: () => void;
  migrationsFolder: string;
  /** Env var the db module reads its path from. Default "DATABASE_PATH". */
  dbPathEnvVar?: string;
  /** Extra env for this run; `undefined` deletes the variable. Applied before any import. */
  env?: Record<string, string | undefined>;
  /** Env vars pointed at fresh temp directories (e.g. upload dirs), keyed by var name. */
  tempDirEnvVars?: readonly string[];
  /** Dynamically imports the service's db module — `() => import("../db/client.js")`. */
  loadDb: () => Promise<{ db: TDb; sqliteClient: { close(): void } }>;
  /** Override the protected real data directory. Tests of the guard itself use this. */
  realDataDir?: string;
}

export interface TestDatabase<TDb> {
  db: TDb;
  dbPath: string;
  /** The temp directory created for each of `tempDirEnvVars`. */
  tempDirs: Record<string, string>;
  cleanup: () => void;
}

/** Path-valued variables the services read besides their database, checked by the guard. */
const PATH_ENV_VARS = [
  "BACKUP_DIR",
  "UPLOADS_DIR",
  "MAP_UPLOADS_DIR",
  "JOURNAL_UPLOADS_DIR",
  "PORTRAIT_UPLOADS_DIR",
  "EXPORT_DIR",
];

function removeQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Windows can briefly hold a handle after close(); the OS temp dir gets swept anyway.
  }
}

/** A migrated, throwaway SQLite database behind the service's own db module. */
export async function createTestDatabase<TDb extends AnyLibSQLDatabase>(
  options: TestDatabaseOptions<TDb>,
): Promise<TestDatabase<TDb>> {
  options.resetModules();

  const runId = `${options.runPrefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dbPath = path.join(os.tmpdir(), `${runId}.sqlite`);
  const dbPathEnvVar = options.dbPathEnvVar ?? "DATABASE_PATH";
  process.env[dbPathEnvVar] = dbPath;

  const tempDirs: Record<string, string> = {};
  for (const envVar of options.tempDirEnvVars ?? []) {
    tempDirs[envVar] = path.join(os.tmpdir(), `${runId}-${envVar.toLowerCase()}`);
    process.env[envVar] = tempDirs[envVar];
  }
  // A developer's .env must never leak into a test app (it can set DEV_ASSUME_ROLE, IMAGE_STORE,
  // real paths...). env.ts loads dotenv on import, so point it at a file that cannot exist; a
  // caller that really wants a file can still pass DOTENV_CONFIG_PATH in `env`.
  process.env.DOTENV_CONFIG_PATH = path.join(os.tmpdir(), `${runId}-no-such.env`);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  // After the caller's env is applied, so an override cannot re-point a path at live data. Every
  // path env var a service reads is checked, whether or not this call created it.
  const realDataDir = options.realDataDir ?? findRealDataDir();
  for (const name of [dbPathEnvVar, ...PATH_ENV_VARS, ...(options.tempDirEnvVars ?? [])]) {
    const value = process.env[name];
    if (value) assertNotRealData(name, value, realDataDir);
  }

  const { db, sqliteClient } = await options.loadDb();
  await runMigrations(db, options.migrationsFolder);

  const cleanup = (): void => {
    sqliteClient.close();
    for (const suffix of ["", "-wal", "-shm"]) removeQuietly(`${dbPath}${suffix}`);
    for (const dir of Object.values(tempDirs)) removeQuietly(dir);
  };

  return { db, dbPath, tempDirs, cleanup };
}

export interface TestContextOptions<TDb extends AnyLibSQLDatabase, TApp>
  extends TestDatabaseOptions<TDb> {
  /** Dynamically imports and builds the app, after the database is ready. */
  loadApp: () => Promise<TApp>;
}

export interface TestContext<TDb, TApp> extends TestDatabase<TDb> {
  /** Hand to supertest: `request(ctx.app)`. */
  app: TApp;
}

/**
 * A fully isolated service instance for route tests: fresh temp SQLite file, migrated, and the
 * app built against it. `db` is the SAME instance the app uses — never import the db module
 * statically in a test, which binds to a stale module from before `resetModules`.
 */
export async function createTestContext<TDb extends AnyLibSQLDatabase, TApp>(
  options: TestContextOptions<TDb, TApp>,
): Promise<TestContext<TDb, TApp>> {
  const database = await createTestDatabase(options);
  try {
    const app = await options.loadApp();
    return { ...database, app };
  } catch (err) {
    database.cleanup();
    throw err;
  }
}
