import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBackup } from "./backup.js";
import {
  assertNotRealData,
  assertNotRealDataInTests,
  findRealDataDir,
  isInsideDirectory,
} from "./realData.js";
import { openSqlite } from "./sqlite.js";

const realDataDir = findRealDataDir();

describe("findRealDataDir", () => {
  it("finds the workspace root's data directory", () => {
    expect(realDataDir).toBeDefined();
    expect(path.basename(realDataDir as string)).toBe("data");
    const root = path.dirname(realDataDir as string);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(manifest.workspaces).toBeDefined();
  });

  it("returns undefined outside any workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "no-workspace-"));
    try {
      expect(findRealDataDir(outside)).toBeUndefined();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("isInsideDirectory", () => {
  it("accepts the directory and descendants, rejects siblings and parents", () => {
    const dir = path.resolve("/some/where/data");
    expect(isInsideDirectory(dir, dir)).toBe(true);
    expect(isInsideDirectory(path.join(dir, "builders.sqlite"), dir)).toBe(true);
    expect(isInsideDirectory(path.join(dir, "..", "data-other", "x"), dir)).toBe(false);
    expect(isInsideDirectory(path.dirname(dir), dir)).toBe(false);
  });
});

describe("assertNotRealData", () => {
  it("throws for the real database, backups and uploads, and allows temp paths", () => {
    const dir = realDataDir as string;
    expect(() => assertNotRealData("DATABASE_PATH", path.join(dir, "builders.sqlite"))).toThrow(
      /real data directory/,
    );
    expect(() => assertNotRealData("BACKUP_DIR", path.join(dir, "backups"))).toThrow();
    expect(() => assertNotRealData("X", path.join(os.tmpdir(), "x.sqlite"))).not.toThrow();
  });
});

describe("the always-on guards under vitest", () => {
  it("is active in this run", () => {
    const target = path.join(realDataDir as string, "never-created.sqlite");
    expect(() => assertNotRealDataInTests("path", target)).toThrow();
  });

  it("openSqlite refuses a path in the real data directory before creating anything", async () => {
    const target = path.join(realDataDir as string, "guard-test-should-not-exist.sqlite");
    await expect(openSqlite({ path: target, schema: {} })).rejects.toThrow(/real data directory/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("createBackup refuses to write into the real data directory", async () => {
    const backupDir = path.join(realDataDir as string, "guard-test-backups");
    const service = createBackup({
      prefix: "guard-",
      dbPath: path.join(os.tmpdir(), "irrelevant.sqlite"),
      dbClient: { execute: async () => undefined },
      backupDir,
    });
    await expect(service.run()).rejects.toThrow(/real data directory/);
    expect(fs.existsSync(backupDir)).toBe(false);
  });
});
