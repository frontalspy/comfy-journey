import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureMigrationsFolder } from "../../fixtures/migrationsFolder.js";
import { assertNotRealData } from "../realData.js";
import { createTestContext, createTestDatabase } from "./createTestContext.js";
import { isolateTestEnvironment } from "./isolateEnv.js";

const loadDb = () => import("../../fixtures/fixtureDb.js");
const loadDatabase = loadDb;

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("createTestDatabase", () => {
  it("points the db module at a fresh migrated file and sets per-run env", async () => {
    const database = await createTestDatabase({
      runPrefix: "server-kit-test",
      resetModules: vi.resetModules,
      migrationsFolder: fixtureMigrationsFolder,
      env: { NODE_ENV: "test", SOME_UNSET_VAR: undefined },
      tempDirEnvVars: ["UPLOADS_DIR"],
      loadDb,
    });
    cleanup = database.cleanup;

    expect(process.env.DATABASE_PATH).toBe(database.dbPath);
    expect(process.env.UPLOADS_DIR).toBe(database.tempDirs.UPLOADS_DIR);
    expect(process.env.SOME_UNSET_VAR).toBeUndefined();

    const { notes } = await import("../../fixtures/fixtureDb.js");
    await database.db.insert(notes).values({ id: "1", body: "hi" });
    expect(await database.db.select().from(notes)).toEqual([{ id: "1", body: "hi" }]);
  });

  it("gives every call its own database", async () => {
    const options = {
      runPrefix: "server-kit-test",
      resetModules: vi.resetModules,
      migrationsFolder: fixtureMigrationsFolder,
      loadDb,
    };
    const first = await createTestDatabase(options);
    const { notes } = await import("../../fixtures/fixtureDb.js");
    await first.db.insert(notes).values({ id: "1", body: "first" });

    const second = await createTestDatabase(options);
    cleanup = () => {
      first.cleanup();
      second.cleanup();
    };
    expect(second.dbPath).not.toBe(first.dbPath);
    expect(await second.db.select().from(notes)).toEqual([]);
  });

  it("removes the database file and temp dirs on cleanup", async () => {
    const database = await createTestDatabase({
      runPrefix: "server-kit-test",
      resetModules: vi.resetModules,
      migrationsFolder: fixtureMigrationsFolder,
      tempDirEnvVars: ["UPLOADS_DIR"],
      loadDb,
    });
    fs.mkdirSync(database.tempDirs.UPLOADS_DIR as string);
    database.cleanup();
    expect(fs.existsSync(database.tempDirs.UPLOADS_DIR as string)).toBe(false);
  });
});

describe("real data guard", () => {
  const base = {
    runPrefix: "server-kit-test",
    resetModules: vi.resetModules,
    migrationsFolder: fixtureMigrationsFolder,
  };

  it("refuses an env override that points DATABASE_PATH into the real data directory", async () => {
    const protectedDir = fs.mkdtempSync(path.join(os.tmpdir(), "protected-data-"));
    const loadDb = vi.fn(loadDatabase);
    try {
      await expect(
        createTestDatabase({
          ...base,
          realDataDir: protectedDir,
          env: { DATABASE_PATH: path.join(protectedDir, "builders.sqlite") },
          loadDb,
        }),
      ).rejects.toThrow(/DATABASE_PATH .* real data directory/);
      expect(loadDb).not.toHaveBeenCalled();
      expect(fs.readdirSync(protectedDir)).toEqual([]);
    } finally {
      fs.rmSync(protectedDir, { recursive: true, force: true });
    }
  });

  it("refuses an upload or backup directory inherited from the shell that is inside it", async () => {
    const protectedDir = fs.mkdtempSync(path.join(os.tmpdir(), "protected-data-"));
    try {
      await expect(
        createTestDatabase({
          ...base,
          realDataDir: protectedDir,
          env: { BACKUP_DIR: path.join(protectedDir, "backups") },
          loadDb: loadDatabase,
        }),
      ).rejects.toThrow(/BACKUP_DIR/);
    } finally {
      delete process.env.BACKUP_DIR;
      fs.rmSync(protectedDir, { recursive: true, force: true });
    }
  });

  it("points dotenv at a file that does not exist so a local .env cannot leak in", async () => {
    const database = await createTestDatabase({ ...base, loadDb: loadDatabase });
    cleanup = database.cleanup;
    expect(process.env.DOTENV_CONFIG_PATH).toBeDefined();
    expect(fs.existsSync(process.env.DOTENV_CONFIG_PATH as string)).toBe(false);
  });
});

describe("createTestContext", () => {
  it("builds the app after the database is ready", async () => {
    const context = await createTestContext({
      runPrefix: "server-kit-test",
      resetModules: vi.resetModules,
      migrationsFolder: fixtureMigrationsFolder,
      loadDb,
      loadApp: async () => {
        const { db, notes } = await import("../../fixtures/fixtureDb.js");
        const app = express();
        app.get("/notes", async (_req, res) => {
          res.json(await db.select().from(notes));
        });
        return app;
      },
    });
    cleanup = context.cleanup;

    const { notes } = await import("../../fixtures/fixtureDb.js");
    await context.db.insert(notes).values({ id: "n", body: "shared" });
    const res = await request(context.app).get("/notes");
    expect(res.body).toEqual([{ id: "n", body: "shared" }]);
  });
});

describe("isolateTestEnvironment", () => {
  it("points the database, backups, upload dirs and dotenv at a throwaway directory", () => {
    const saved = { ...process.env };
    try {
      const root = isolateTestEnvironment({
        runPrefix: "server-kit-test",
        dirEnvVars: ["UPLOADS_DIR"],
      });
      expect(process.env.DATABASE_PATH).toBe(path.join(root, "baseline.sqlite"));
      expect(process.env.BACKUP_DIR?.startsWith(root)).toBe(true);
      expect(process.env.UPLOADS_DIR?.startsWith(root)).toBe(true);
      expect(fs.existsSync(process.env.DOTENV_CONFIG_PATH as string)).toBe(false);
      expect(() =>
        assertNotRealData("DATABASE_PATH", process.env.DATABASE_PATH as string),
      ).not.toThrow();
      fs.rmSync(root, { recursive: true, force: true });
    } finally {
      process.env = saved;
    }
  });
});
