import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/** Applies every pending drizzle-kit migration in `migrationsFolder`. Idempotent. */
export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  migrationsFolder: string,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
