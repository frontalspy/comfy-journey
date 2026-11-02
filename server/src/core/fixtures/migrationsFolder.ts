import path from "node:path";

/** fixtures/migrations: one drizzle-kit migration creating a `notes (id, body)` table. */
export const fixtureMigrationsFolder = path.resolve(import.meta.dirname, "migrations");
