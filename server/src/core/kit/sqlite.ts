import { type Client, createClient, type TransactionMode } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { assertNotRealDataInTests } from "./realData.js";

export interface OpenSqliteOptions<TSchema extends Record<string, unknown>> {
  /** Filesystem path to the SQLite file. Created if it doesn't exist. */
  path: string;
  schema: TSchema;
  /** Sets `PRAGMA busy_timeout` so a write that meets another connection's lock waits this many
   *  milliseconds instead of failing at once with SQLITE_BUSY. Defaults to 5000. */
  busyTimeoutMs?: number;
}

export interface SqliteHandle<TSchema extends Record<string, unknown>> {
  path: string;
  /** The raw libsql client â€” for VACUUM INTO backups and closing the connection. */
  client: Client;
  db: LibSQLDatabase<TSchema>;
}

/** Long enough to ride out a backup's VACUUM INTO or a migration; short enough to fail loudly. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Opens a service's SQLite file with foreign keys enforced and a busy timeout set. SQLite keeps
 * both per connection, and libsql swaps in a brand-new connection after every
 * `client.transaction()` (the transaction keeps the old one), so the pragmas are re-applied on
 * the replacement each time — otherwise the first transaction would silently drop them.
 */
export async function openSqlite<TSchema extends Record<string, unknown>>(
  options: OpenSqliteOptions<TSchema>,
): Promise<SqliteHandle<TSchema>> {
  assertNotRealDataInTests("The SQLite database path", options.path);
  const client = createClient({ url: `file:${options.path}` });
  const busyTimeoutMs = Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);
  const applyPragmas = (): Promise<unknown> =>
    Promise.all([
      client.execute("PRAGMA foreign_keys = ON"),
      client.execute(`PRAGMA busy_timeout = ${busyTimeoutMs}`),
    ]);

  await applyPragmas();
  const openTransaction = client.transaction.bind(client);
  client.transaction = async (mode?: TransactionMode) => {
    // libsql discards its connection synchronously inside transaction(), so the pragmas are
    // issued in the same tick, before anything else can run on the fresh connection.
    const transaction = openTransaction(mode);
    const reapplied = applyPragmas();
    try {
      const [opened] = await Promise.all([transaction, reapplied]);
      return opened;
    } catch (error) {
      await reapplied.catch(() => undefined);
      throw error;
    }
  };
  return { path: options.path, client, db: drizzle(client, { schema: options.schema }) };
}
