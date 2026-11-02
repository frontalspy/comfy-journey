import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertJob } from "../jobs/jobRepo.js";
import { asUser, type UserClient } from "../test/asUser.js";
import { ALICE, createHarness, type Harness, scriptSuccess } from "../test/harness.js";
import { runToDone } from "../test/jobHelpers.js";
import { uploadPng } from "../test/uploadHelpers.js";
import { insertImage } from "./imageRepo.js";
import { deleteOwnedImage } from "./imageService.js";

let h: Harness;
let alice: UserClient;
beforeEach(async () => {
  h = await createHarness();
  alice = asUser(h, ALICE);
});
afterEach(async () => {
  await h.close();
});

const jobStatus = async (id: string): Promise<number> =>
  (await alice.get(`/api/jobs/${id}`)).status;

describe("a finished job with no images left", () => {
  it("is deleted along with its last image, files included", async () => {
    const { id, imageIds } = await runToDone(alice);
    expect((await alice.delete(`/api/images/${imageIds[0]}`)).status).toBe(204);
    expect(await jobStatus(id)).toBe(404);
    expect((await alice.get("/api/jobs")).body).toEqual([]);
    const media = path.join(h.dataDir, "media");
    const left = fs.existsSync(media)
      ? fs.readdirSync(media).flatMap((dir) => fs.readdirSync(path.join(media, dir)))
      : [];
    expect(left).toEqual([]);
  });

  it("stays while any image remains, listing only the survivors", async () => {
    await scriptSuccess(h.comfy, { outputs: 3 });
    const { id, imageIds } = await runToDone(alice);
    await alice.delete(`/api/images/${imageIds[0]}`);
    await alice.delete(`/api/images/${imageIds[1]}`);
    const job = await alice.get(`/api/jobs/${id}`);
    expect(job.status).toBe(200);
    expect(job.body.imageIds).toEqual([imageIds[2]]);
    await alice.delete(`/api/images/${imageIds[2]}`);
    expect(await jobStatus(id)).toBe(404);
  });

  it("is deleted exactly once when its last two images go at the same moment", async () => {
    await scriptSuccess(h.comfy, { outputs: 4 });
    const { id, imageIds } = await runToDone(alice);
    const results = await Promise.all(
      imageIds.map((imageId) => alice.delete(`/api/images/${imageId}`)),
    );
    expect(results.map((res) => res.status)).toEqual([204, 204, 204, 204]);
    expect(await jobStatus(id)).toBe(404);
    const left = await h.services.handle.client.execute("select count(*) as n from jobs");
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  it("does not stop the retention sweep from running cleanly afterwards", async () => {
    const { imageIds } = await runToDone(alice);
    await alice.delete(`/api/images/${imageIds[0]}`);
    expect(await h.services.sweep()).toMatchObject({ jobsRemoved: 0, filesRemoved: 0 });
  });
});

describe("what the empty-job rule leaves alone", () => {
  it("keeps a queued or running job even when its image row is deleted", async () => {
    for (const status of ["queued", "running"]) {
      const jobId = `job-${status}`;
      await insertJob(h.services.db, {
        id: jobId,
        ownerId: ALICE,
        workflowId: "fixture-txt2img",
        workflowHash: "h",
        params: {},
        status,
        createdAt: new Date().toISOString(),
      });
      await insertImage(h.services.db, {
        id: `image-${status}`,
        jobId,
        ownerId: ALICE,
        kind: "image",
        fileKey: `x/${status}.png`,
        mime: "image/png",
        bytes: 1,
        createdAt: new Date().toISOString(),
      });
      expect(
        await deleteOwnedImage(h.services.db, h.services.ctx.store, ALICE, `image-${status}`),
      ).toBe(true);
      expect(await jobStatus(jobId)).toBe(200);
    }
  });

  it("never removes a job because an upload was deleted", async () => {
    const { id } = await runToDone(alice);
    const upload = await uploadPng(alice);
    expect((await alice.delete(`/api/images/${upload.id}`)).status).toBe(204);
    expect(await jobStatus(id)).toBe(200);
  });
});
