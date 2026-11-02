import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureMigrationsFolder } from "../fixtures/migrationsFolder.js";
import { runMigrations } from "./migrations.js";
import { openSqlite } from "./sqlite.js";

const opened: Array<{ close(): void }> = [];
const files: string[] = [];

function tempDbPath(): string {
  const file = path.join(os.tmpdir(), `server-kit-sqlite-${process.pid}-${Math.random()}.sqlite`);
  files.push(file);
  return file;
}

afterEach(() => {
  for (const client of opened.splice(0)) client.close();
  for (const file of files.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Windows can briefly hold the handle after close(); the temp dir gets swept anyway.
    }
  }
});

describe("openSqlite", () => {
  it("opens the file with foreign keys enforced", async () => {
    const handle = await openSqlite({ path: tempDbPath(), schema: {} });
    opened.push(handle.client);
    const result = await handle.client.execute("PRAGMA foreign_keys");
    expect(Number(result.rows[0]?.[0])).toBe(1);
  });

  it("sets the busy timeout, defaulting to 5000 when not asked", async () => {
    const withTimeout = await openSqlite({ path: tempDbPath(), schema: {}, busyTimeoutMs: 4321 });
    opened.push(withTimeout.client);
    const set = await withTimeout.client.execute("PRAGMA busy_timeout");
    expect(Number(set.rows[0]?.[0])).toBe(4321);

    const untouched = await openSqlite({ path: tempDbPath(), schema: {} });
    opened.push(untouched.client);
    const unset = await untouched.client.execute("PRAGMA busy_timeout");
    expect(Number(unset.rows[0]?.[0])).toBe(5000);
  });
});

describe("openSqlite after client.transaction()", () => {
  it("keeps busy_timeout and foreign_keys on the connection libsql opens afterwards", async () => {
    const handle = await openSqlite({ path: tempDbPath(), schema: {}, busyTimeoutMs: 4321 });
    opened.push(handle.client);

    const tx = await handle.client.transaction("write");
    await tx.commit();
    tx.close();
    // Drizzle's db.transaction() goes through the same client.transaction().
    await handle.db.transaction(async () => {});

    const timeout = await handle.client.execute("PRAGMA busy_timeout");
    const foreignKeys = await handle.client.execute("PRAGMA foreign_keys");
    expect(Number(timeout.rows[0]?.[0])).toBe(4321);
    expect(Number(foreignKeys.rows[0]?.[0])).toBe(1);
  });

  it("enforces foreign keys after a transaction", async () => {
    const handle = await openSqlite({ path: tempDbPath(), schema: {} });
    opened.push(handle.client);
    await handle.client.execute("create table p (id integer primary key)");
    await handle.client.execute("create table c (pid integer references p(id))");
    const tx = await handle.client.transaction("write");
    await tx.commit();
    await expect(handle.client.execute("insert into c values (99)")).rejects.toThrow(
      /FOREIGN KEY/i,
    );
  });
});

describe("runMigrations", () => {
  it("applies pending migrations and is idempotent", async () => {
    const handle = await openSqlite({ path: tempDbPath(), schema: {} });
    opened.push(handle.client);

    await runMigrations(handle.db, fixtureMigrationsFolder);
    await runMigrations(handle.db, fixtureMigrationsFolder);

    await handle.client.execute("insert into notes (id, body) values ('1', 'hello')");
    const rows = await handle.client.execute("select body from notes");
    expect(rows.rows.map((row) => row.body)).toEqual(["hello"]);
  });
});
