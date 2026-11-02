import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { openSqlite } from "../kit/sqlite.js";

/** The one table fixtures/migrations creates — a stand-in for a service's schema. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
});

/** A stand-in for a service's db/client.ts: opens DATABASE_PATH as a side effect of import. */
const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("fixtureDb: DATABASE_PATH must be set before import");
const handle = await openSqlite({ path: dbPath, schema: { notes } });

export const db = handle.db;
export const sqliteClient = handle.client;
