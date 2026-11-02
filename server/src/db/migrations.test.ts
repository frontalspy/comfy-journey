import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { removeQuietly } from "../test/testApp.js";
import { openAppDb } from "./client.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeQuietly(dir);
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-migration-"));
  dirs.push(dir);
  return dir;
}

describe("the initial migration", () => {
  it("creates the three tables, owner-scoped, with an uploaded image allowed to have no job", async () => {
    const dir = tempDir();
    const handle = await openAppDb(dir);
    handle.client.close();
    const client = createClient({ url: `file:${path.join(dir, "comfy.sqlite")}` });
    const tables = (await client.execute("select name from sqlite_master where type='table'")).rows
      .map((row) => String(row.name))
      .filter((name) => !name.startsWith("__") && !name.startsWith("sqlite_"));
    expect(tables.sort()).toEqual(["images", "jobs", "user_settings"]);

    for (const table of ["images", "jobs"]) {
      const columns = (await client.execute(`pragma table_info(${table})`)).rows.map((r) =>
        String(r.name),
      );
      expect(columns, table).toContain("owner_id");
      expect(columns, table).not.toContain("owner_email");
    }

    await client.execute(
      `insert into images (id, job_id, owner_id, kind, file_key, mime, bytes, created_at)
       values ('img-1', null, 'a', 'image', 'f/1.png', 'image/png', 10, '2024-01-01T00:00:00.000Z')`,
    );
    const row = (await client.execute("select source, favourite, nsfw from images")).rows[0];
    expect([row?.source, row?.favourite, row?.nsfw]).toEqual(["generated", 0, 0]);
    client.close();
  });

  it("indexes the owner and date columns every list is sorted by", async () => {
    const dir = tempDir();
    const handle = await openAppDb(dir);
    handle.client.close();
    const client = createClient({ url: `file:${path.join(dir, "comfy.sqlite")}` });
    const indexes = (await client.execute("select name from sqlite_master where type='index'")).rows
      .map((row) => String(row.name))
      .filter((name) => !name.startsWith("sqlite_"));
    expect(indexes).toEqual(
      expect.arrayContaining([
        "images_owner_created_idx",
        "images_owner_source_created_idx",
        "jobs_owner_created_idx",
        "jobs_status_created_idx",
      ]),
    );
    client.close();
  });
});
