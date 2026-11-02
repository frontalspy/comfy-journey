import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeQuietly } from "../test/testApp.js";
import { BACKUP_PREFIX, createAppBackup } from "./backup.js";
import { openAppDb } from "./client.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeQuietly(dir);
});

describe("backups", () => {
  it("snapshots under its own prefix and prunes only its own snapshots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-backup-"));
    dirs.push(root);
    const backupDir = path.join(root, "backups");
    fs.mkdirSync(backupDir);
    const foreign = path.join(backupDir, "builders-2020-01-01.sqlite");
    fs.writeFileSync(foreign, "not ours");

    const handle = await openAppDb(path.join(root, "data"));
    const backup = createAppBackup(
      {
        dataDir: path.join(root, "data"),
        comfyUrl: "http://x",
        workflowsDir: root,
        allowNsfwWorkflows: true,
        backupDir,
        backupRetention: "1",
      },
      handle,
    );
    expect(BACKUP_PREFIX).toBe("comfy");
    const first = await backup.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await backup.run();

    const ours = fs.readdirSync(backupDir).filter((name) => name.startsWith(BACKUP_PREFIX));
    expect(path.basename(first).startsWith(BACKUP_PREFIX)).toBe(true);
    expect(ours).toHaveLength(1);
    expect(fs.existsSync(foreign)).toBe(true);
    handle.client.close();
  });

  it("migrates a fresh database to the current schema", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-migrate-"));
    dirs.push(root);
    const handle = await openAppDb(root);
    const tables = await handle.client.execute(
      "select name from sqlite_master where type = 'table' and name in ('jobs','images','user_settings') order by name",
    );
    expect(tables.rows.map((row) => row.name)).toEqual(["images", "jobs", "user_settings"]);
    handle.client.close();
  });
});
