import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { insertJob } from "../jobs/jobRepo.js";
import { asUser } from "../test/asUser.js";
import { ALICE, createHarness, type Harness } from "../test/harness.js";
import { runToDone } from "../test/jobHelpers.js";
import type { MediaArea, MediaStore } from "./mediaStore.js";

const localPath = (store: MediaStore, area: MediaArea, key: string): string => {
  const found = store.localPath(area, key);
  if (!found) throw new Error("not a disk backend");
  return found;
};
const DAY_MS = 24 * 60 * 60 * 1000;
let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const jobRow = (id: string, status: string, ageDays: number, finished: boolean) => {
  const when = new Date(Date.now() - ageDays * DAY_MS).toISOString();
  return {
    id,
    ownerId: ALICE,
    workflowId: "fixture-txt2img",
    workflowHash: "h",
    params: {},
    status,
    createdAt: when,
    finishedAt: finished ? when : null,
  };
};

async function jobIds(h: Harness): Promise<string[]> {
  const result = await h.services.handle.client.execute("select id from jobs order by id");
  return result.rows.map((row) => String(row.id));
}

describe("retention sweep", () => {
  it("removes failed and cancelled jobs older than 7 days for every user, and keeps the rest", async () => {
    const h = await createHarness({ start: false });
    harness = h;
    const { db } = h.services;
    await insertJob(db, jobRow("old-failed", "failed", 8, true));
    await insertJob(db, jobRow("old-cancelled", "cancelled", 9, false));
    await insertJob(db, {
      ...jobRow("other-user", "failed", 8, true),
      ownerId: "bob@example.com",
    });
    await insertJob(db, jobRow("recent-failed", "failed", 1, true));
    await insertJob(db, jobRow("old-done", "done", 30, true));
    await insertJob(db, jobRow("old-queued", "queued", 30, false));

    const result = await h.services.sweep();
    expect(result.jobsRemoved).toBe(3);
    expect(await jobIds(h)).toEqual(["old-done", "old-queued", "recent-failed"]);
  });

  it("removes orphan files but never referenced ones or fresh ones", async () => {
    const h = await createHarness();
    harness = h;
    const alice = asUser(h, ALICE);
    const { store } = h.services.ctx;
    const { imageIds } = await runToDone(alice);
    const record = await h.services.handle.client.execute("select file_key, thumb_key from images");
    const keptMedia = localPath(store, "media", String(record.rows[0]?.file_key));
    const keptThumb = localPath(store, "thumbs", String(record.rows[0]?.thumb_key));

    const staleKey = await store.write("media", ALICE, Buffer.from("orphan"), "png");
    const stalePath = localPath(store, "media", staleKey);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, twoHoursAgo, twoHoursAgo);
    const freshKey = await store.write("thumbs", ALICE, Buffer.from("fresh"), "webp");
    const freshPath = localPath(store, "thumbs", freshKey);

    const result = await h.services.sweep();
    expect(result.filesRemoved).toBe(1);
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(freshPath)).toBe(true);
    expect(fs.existsSync(keptMedia)).toBe(true);
    expect(fs.existsSync(keptThumb)).toBe(true);
    expect((await alice.get(`/api/images/${imageIds[0]}/file`)).status).toBe(200);
  });

  it("runs once at boot", async () => {
    const before = await createHarness({ start: false });
    await insertJob(before.services.db, jobRow("ancient-failed", "failed", 20, true));
    await before.services.stop();
    const after = await createHarness({ dataDir: before.dataDir, comfy: before.comfy });
    harness = after;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await jobIds(after)).toEqual([]);
  });
});
