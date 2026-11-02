import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, type UserClient } from "./asUser.js";
import { ALICE, BOB, createHarness, type Harness, until } from "./harness.js";
import { uploadPng } from "./uploadHelpers.js";

/**
 * The standing leak suite: two
 * identities, every route, and no cross-read or cross-write. Never skip it.
 */
let harness: Harness;
let alice: UserClient;
let bob: UserClient;
let aliceImageId: string;
let aliceJobId: string;
let aliceWaitingJobId: string;
let aliceMediaPath: string;
let holder: { release(): void | Promise<void> };

const NOT_FOUND = { error: expect.any(String) };

beforeAll(async () => {
  harness = await createHarness();
  alice = asUser(harness, ALICE);
  bob = asUser(harness, BOB);

  const created = await alice.post("/api/jobs").send({ workflowId: "fixture-txt2img", values: {} });
  expect(created.status).toBe(202);
  aliceJobId = created.body.id;
  const done = await until(async () => {
    const res = await alice.get(`/api/jobs/${aliceJobId}`);
    return res.body.status === "done" ? res.body : undefined;
  });
  aliceImageId = done.imageIds[0];
  const image = await alice.get(`/api/images/${aliceImageId}`);
  aliceMediaPath = path.join(harness.dataDir, "media");
  expect(image.status).toBe(200);

  // Occupy the GPU so Alice's next job sits in waiting_for_gpu while Bob pokes at it.
  holder = await harness.gate.acquireAs("other-app", { label: "other" });
  const waiting = await alice.post("/api/jobs").send({ workflowId: "fixture-txt2img", values: {} });
  aliceWaitingJobId = waiting.body.id;
  await until(async () => {
    const res = await alice.get(`/api/jobs/${aliceWaitingJobId}`);
    return res.body.status === "waiting_for_gpu";
  });
});

afterAll(async () => {
  await holder.release();
  await harness.close();
});

function mediaFiles(): string[] {
  const out: string[] = [];
  for (const folder of fs.readdirSync(aliceMediaPath)) {
    out.push(...fs.readdirSync(path.join(aliceMediaPath, folder)));
  }
  return out;
}

describe("owner isolation", () => {
  it("answers 404 for another user's job on every job route", async () => {
    for (const res of [
      await bob.get(`/api/jobs/${aliceJobId}`),
      await bob.get(`/api/jobs/${aliceJobId}/events`),
      await bob.post(`/api/jobs/${aliceWaitingJobId}/cancel`),
      await bob.post(`/api/jobs/${aliceJobId}/cancel`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });

  it("answers 404 for another user's image on every image route", async () => {
    const id = aliceImageId;
    const body = { workflowId: "fixture-img2img", values: {} };
    for (const res of [
      await bob.get(`/api/images/${id}`),
      await bob.get(`/api/images/${id}/file`),
      await bob.get(`/api/images/${id}/thumb`),
      await bob.patch(`/api/images/${id}`).send({ favourite: true }),
      await bob.delete(`/api/images/${id}`),
      await bob.post(`/api/images/${id}/variation`).send(body),
      await bob.post(`/api/images/${id}/upscale`).send({ ...body, workflowId: "fixture-upscale" }),
      await bob.post(`/api/images/${id}/animate`).send({ ...body, workflowId: "fixture-i2v" }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });

  it("lets 404 win over 400: a foreign id never reveals itself through validation", async () => {
    const res = await bob.patch(`/api/images/${aliceImageId}`).send({ nope: 1 });
    expect(res.status).toBe(404);
    const derived = await bob.post(`/api/images/${aliceImageId}/variation`).send({});
    expect(derived.status).toBe(404);
  });

  it("shows nobody else's rows in lists", async () => {
    expect((await bob.get("/api/jobs")).body).toEqual([]);
    const images = await bob.get("/api/images");
    expect(images.body.items).toEqual([]);
    expect((await alice.get("/api/images")).body.items).toHaveLength(1);
    expect((await bob.get("/api/images?search=lighthouse")).body.items).toEqual([]);
  });

  it("refuses another user's image as a job input", async () => {
    const res = await bob
      .post("/api/jobs")
      .send({ workflowId: "fixture-img2img", values: { image: aliceImageId } });
    expect(res.status).toBe(400);
  });

  it("hands the owner nothing different from before: nothing was written by the attempts", async () => {
    const image = await alice.get(`/api/images/${aliceImageId}`);
    expect(image.status).toBe(200);
    expect(image.body.favourite).toBe(false);
    expect((await alice.get(`/api/images/${aliceImageId}/file`)).status).toBe(200);
    expect(mediaFiles()).toHaveLength(1);
    expect((await alice.get(`/api/jobs/${aliceJobId}`)).body.status).toBe("done");
    expect((await alice.get(`/api/jobs/${aliceWaitingJobId}`)).body.status).toBe("waiting_for_gpu");
    expect((await alice.get("/api/jobs")).body).toHaveLength(2);
  });

  it("keeps settings per user", async () => {
    expect((await alice.put("/api/settings").send({ nsfwVisible: true })).body).toEqual({
      nsfwVisible: true,
    });
    expect((await bob.get("/api/settings")).body).toEqual({ nsfwVisible: false });
  });

  it("only the owner can cancel, and the owner's cancel works", async () => {
    const res = await alice.post(`/api/jobs/${aliceWaitingJobId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("deletes only the owner's own image", async () => {
    expect((await bob.delete(`/api/images/${aliceImageId}`)).status).toBe(404);
    expect((await alice.delete(`/api/images/${aliceImageId}`)).status).toBe(204);
    expect(mediaFiles()).toHaveLength(0);
    expect((await alice.get(`/api/images/${aliceImageId}`)).status).toBe(404);
  });
});

describe("owner isolation for uploads", () => {
  let uploads: Harness;
  let carol: UserClient;
  let dave: UserClient;
  let uploadId: string;

  beforeAll(async () => {
    uploads = await createHarness();
    carol = asUser(uploads, ALICE);
    dave = asUser(uploads, BOB);
    uploadId = (await uploadPng(carol, "private.png")).id;
  });

  afterAll(async () => {
    await uploads.close();
  });

  it("answers 404 for another user's upload on every image route", async () => {
    const body = { workflowId: "fixture-img2img", values: {} };
    for (const res of [
      await dave.get(`/api/images/${uploadId}`),
      await dave.get(`/api/images/${uploadId}/file`),
      await dave.get(`/api/images/${uploadId}/thumb`),
      await dave.patch(`/api/images/${uploadId}`).send({ favourite: true }),
      await dave.delete(`/api/images/${uploadId}`),
      await dave.post(`/api/images/${uploadId}/variation`).send(body),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    expect((await carol.get(`/api/images/${uploadId}/file`)).status).toBe(200);
  });

  it("lists an upload for its owner only", async () => {
    expect((await dave.get("/api/images?source=upload")).body.items).toEqual([]);
    expect((await carol.get("/api/images?source=upload")).body.items).toHaveLength(1);
    expect((await dave.get("/api/images")).body.items).toEqual([]);
  });

  it("refuses another user's upload as a single or multi image job input", async () => {
    const single = await dave
      .post("/api/jobs")
      .send({ workflowId: "fixture-img2img", values: { image: uploadId } });
    const multi = await dave
      .post("/api/jobs")
      .send({ workflowId: "fixture-refs", values: { refs: [uploadId] } });
    expect(single.status).toBe(400);
    expect(multi.status).toBe(400);
    expect(JSON.stringify([single.body, multi.body])).not.toContain(uploadId);
    expect((await dave.get("/api/jobs")).body).toEqual([]);
  });

  it("leaves the upload untouched after the attempts", async () => {
    const image = await carol.get(`/api/images/${uploadId}`);
    expect(image.status).toBe(200);
    expect(image.body).toMatchObject({ favourite: false, source: "upload" });
  });
});
