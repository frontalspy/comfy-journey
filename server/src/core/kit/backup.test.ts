import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BackupOptions, createBackup } from "./backup.js";
import { openSqlite } from "./sqlite.js";

const silent = { log: () => {}, error: () => {} };
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A real SQLite file with one row, an empty backup dir, and a place for uploads. */
async function harness(overrides: Partial<BackupOptions> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-kit-backup-"));
  const dbPath = path.join(root, "service.sqlite");
  const backupDir = path.join(root, "backups");
  const uploadsDir = path.join(root, "uploads");
  fs.mkdirSync(backupDir);

  const handle = await openSqlite({ path: dbPath, schema: {} });
  await handle.client.execute("create table things (name text)");
  await handle.client.execute("insert into things values ('Aramil')");

  const backup = createBackup({
    prefix: "svc-",
    dbClient: handle.client,
    dbPath,
    backupDir,
    log: silent,
    ...overrides,
  });
  cleanups.push(() => {
    handle.client.close();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold the handle after close(); the temp dir gets swept anyway.
    }
  });
  return {
    backup,
    backupDir,
    uploadsDir,
    dbPath,
    client: handle.client,
    stub: (name: string) => fs.writeFileSync(path.join(backupDir, name), ""),
    list: () => fs.readdirSync(backupDir).sort(),
  };
}

describe("createBackup", () => {
  it("requires a non-empty prefix, since pruning is scoped by it", async () => {
    const h = await harness();
    for (const prefix of ["", "  ", "a/b"]) {
      expect(() =>
        createBackup({ prefix, dbClient: h.client, dbPath: h.dbPath, log: silent }),
      ).toThrow(/prefix/);
    }
  });

  it("writes a snapshot that can be opened and read back", async () => {
    const h = await harness();
    const backupPath = await h.backup.run();
    expect(path.basename(backupPath).startsWith("svc-")).toBe(true);

    const restored = createClient({ url: `file:${backupPath}` });
    const result = await restored.execute("select name from things");
    expect(result.rows.map((row) => row.name)).toEqual(["Aramil"]);
    restored.close();
  });

  it("defaults to a backups/ directory beside the database", async () => {
    const h = await harness();
    const service = createBackup({ prefix: "svc-", dbClient: h.client, dbPath: h.dbPath });
    expect(service.backupDir).toBe(path.join(path.dirname(h.dbPath), "backups"));
  });

  it("falls back to default retention and interval for missing or invalid values", async () => {
    const h = await harness({ retention: "nonsense", intervalDays: "0" });
    expect(h.backup.retention).toBe(14);
    expect(h.backup.intervalDays).toBe(7);
    const custom = await harness({ retention: "3", intervalDays: 0.5 });
    expect(custom.backup.retention).toBe(3);
    expect(custom.backup.intervalDays).toBe(0.5);
  });

  it("prunes its own snapshots down to the retention count, newest kept", async () => {
    const h = await harness({ retention: 3 });
    for (const day of ["01", "02", "03", "04", "05"]) {
      h.stub(`svc-2020-01-${day}T00-00-00-000Z.sqlite`);
    }
    const backupPath = await h.backup.run();
    expect(h.list()).toEqual(
      [
        path.basename(backupPath),
        "svc-2020-01-05T00-00-00-000Z.sqlite",
        "svc-2020-01-04T00-00-00-000Z.sqlite",
      ].sort(),
    );
  });

  it("never touches another service's snapshots in the same directory", async () => {
    const h = await harness({ retention: 1 });
    for (const day of ["01", "02", "03", "04", "05"]) {
      h.stub(`other-2020-01-${day}T00-00-00-000Z.sqlite`);
      fs.mkdirSync(path.join(h.backupDir, `other-2020-01-${day}T00-00-00-000Z-uploads`));
    }
    h.stub("svc-2020-01-01T00-00-00-000Z.sqlite");

    await h.backup.run();

    const remaining = h.list();
    expect(remaining.filter((name) => name.startsWith("other-"))).toHaveLength(10);
    expect(remaining.filter((name) => name.startsWith("svc-"))).toHaveLength(1);
  });

  it("copies non-empty upload dirs beside the snapshot, flat or into subfolders", async () => {
    const h = await harness();
    const flat = path.join(h.uploadsDir, "flat");
    const maps = path.join(h.uploadsDir, "maps");
    const empty = path.join(h.uploadsDir, "empty");
    for (const dir of [flat, maps, empty]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(flat, "a.webp"), "flat-bytes");
    fs.writeFileSync(path.join(maps, "m.webp"), "map-bytes");

    const service = createBackup({
      prefix: "svc-",
      dbClient: h.client,
      dbPath: h.dbPath,
      backupDir: h.backupDir,
      log: silent,
      uploads: [{ dir: flat }, { dir: maps, subfolder: "maps" }, { dir: empty, subfolder: "e" }],
    });
    const backupPath = await service.run();
    const uploadsCopy = backupPath.replace(/\.sqlite$/, "-uploads");

    expect(fs.readFileSync(path.join(uploadsCopy, "a.webp"), "utf8")).toBe("flat-bytes");
    expect(fs.readFileSync(path.join(uploadsCopy, "maps", "m.webp"), "utf8")).toBe("map-bytes");
    expect(fs.existsSync(path.join(uploadsCopy, "e"))).toBe(false);
  });

  it("skips the uploads copy entirely when nothing has been uploaded", async () => {
    const h = await harness({ uploads: [{ dir: "/definitely/not/here" }] });
    const backupPath = await h.backup.run();
    expect(fs.existsSync(backupPath.replace(/\.sqlite$/, "-uploads"))).toBe(false);
  });

  it("prunes old uploads copies alongside their snapshots", async () => {
    const h = await harness({ retention: 1 });
    fs.mkdirSync(path.join(h.backupDir, "svc-2020-01-01T00-00-00-000Z-uploads"));
    fs.mkdirSync(h.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(h.uploadsDir, "a.webp"), "x");
    const service = createBackup({
      prefix: "svc-",
      dbClient: h.client,
      dbPath: h.dbPath,
      backupDir: h.backupDir,
      retention: 1,
      log: silent,
      uploads: [{ dir: h.uploadsDir }],
    });

    await service.run();

    const uploadCopies = h.list().filter((name) => name.endsWith("-uploads"));
    expect(uploadCopies).toHaveLength(1);
    expect(uploadCopies).not.toContain("svc-2020-01-01T00-00-00-000Z-uploads");
  });

  it("does not let a longer prefix's snapshots count against a shorter one", async () => {
    const h = await harness({ retention: 1 });
    h.stub("svc-old-2020-01-01T00-00-00-000Z.sqlite");
    h.stub("svc-old-2020-01-02T00-00-00-000Z.sqlite");
    await h.backup.run();
    expect(h.list().filter((name) => name.startsWith("svc-old-"))).toHaveLength(2);
  });

  it("keeps pruning when one stale snapshot cannot be deleted", async () => {
    const h = await harness({ retention: 1 });
    // A directory wearing a snapshot's name cannot be unlinked as a file; it is also ignored.
    fs.mkdirSync(path.join(h.backupDir, "svc-2020-01-01T00-00-00-000Z.sqlite"));
    h.stub("svc-2020-01-02T00-00-00-000Z.sqlite");
    await expect(h.backup.run()).resolves.toBeTypeOf("string");
  });

  describe("startScheduler", () => {
    const snapshotNames = (h: { list(): string[] }) =>
      h.list().filter((n) => n.endsWith(".sqlite"));

    it("skips the startup backup when the newest snapshot is younger than the interval", async () => {
      const h = await harness({ intervalDays: 1, retention: 2 });
      const recent = `svc-${new Date(Date.now() - 3_600_000).toISOString().replace(/[:.]/g, "-")}.sqlite`;
      h.stub(recent);
      const stop = h.backup.startScheduler();
      cleanups.push(stop);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(snapshotNames(h)).toEqual([recent]);
    });

    it("repeated restarts never evict older snapshots", async () => {
      const h = await harness({ intervalDays: 1, retention: 2 });
      h.stub("svc-2020-01-01T00-00-00-000Z.sqlite");
      for (let restart = 0; restart < 4; restart++) {
        const stop = h.backup.startScheduler();
        cleanups.push(stop);
        await vi.waitFor(() => expect(snapshotNames(h).length).toBeGreaterThanOrEqual(2));
        stop();
      }
      expect(snapshotNames(h)).toHaveLength(2);
      expect(snapshotNames(h)).toContain("svc-2020-01-01T00-00-00-000Z.sqlite");
    });

    it("backs up at startup when the newest snapshot is older than the interval", async () => {
      const h = await harness({ intervalDays: 1 });
      h.stub("svc-2020-01-01T00-00-00-000Z.sqlite");
      cleanups.push(h.backup.startScheduler());
      await vi.waitFor(() => expect(snapshotNames(h)).toHaveLength(2));
    });

    it("backs up at startup when there are no snapshots", async () => {
      const h = await harness();
      cleanups.push(h.backup.startScheduler());
      await vi.waitFor(() => expect(snapshotNames(h)).toHaveLength(1));
    });
  });
});
