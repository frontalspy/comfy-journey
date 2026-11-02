import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertImage } from "../images/imageRepo.js";
import { UPLOAD_LIMITS } from "../images/uploadLimits.js";
import { asUser, type UserClient } from "../test/asUser.js";
import { ALICE, BOB, createHarness, type Harness } from "../test/harness.js";
import { submitJob, waitForStatus } from "../test/jobHelpers.js";
import { uploadPng } from "../test/uploadHelpers.js";
import { MESSAGES } from "./jobFailure.js";

let h: Harness;
let alice: UserClient;
let bob: UserClient;
beforeEach(async () => {
  h = await createHarness({ start: false });
  alice = asUser(h, ALICE);
  bob = asUser(h, BOB);
});
afterEach(async () => {
  await h.close();
});

async function storedParams(jobId: string): Promise<unknown> {
  const found = await h.services.handle.client.execute({
    sql: "select params from jobs where id = ?",
    args: [jobId],
  });
  return JSON.parse(String(found.rows[0]?.params));
}

type Submitted = { prompt: Record<string, { inputs: Record<string, unknown> }> };
const lastPrompt = (): Submitted => h.comfy.submitted.at(-1) as Submitted;

describe("image inputs at job creation", () => {
  it("answers the same 400 for someone else's image and for one that does not exist", async () => {
    const theirs = await uploadPng(alice);
    const body = (image: string) => ({ workflowId: "fixture-img2img", values: { image } });
    const foreign = await bob.post("/api/jobs").send(body(theirs.id));
    const missing = await bob.post("/api/jobs").send(body("00000000-no-such-image"));
    expect(foreign.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(foreign.body).toEqual(missing.body);

    const refs = (ids: string[]) => ({ workflowId: "fixture-refs", values: { refs: ids } });
    const mine = await uploadPng(bob);
    const mixed = await bob.post("/api/jobs").send(refs([mine.id, theirs.id]));
    expect(mixed.status).toBe(400);
    expect(JSON.stringify(mixed.body)).not.toContain(theirs.id);
    expect((await bob.get("/api/jobs")).body).toEqual([]);
  });

  it("accepts an upload as the single image of an image workflow", async () => {
    const upload = await uploadPng(alice, "start.png");
    const job = await submitJob(alice, {
      workflowId: "fixture-img2img",
      values: { image: upload.id },
    });
    await h.services.worker.start();
    const done = await waitForStatus(alice, job.id, "done");
    // The graph got a generated name, never the stored id or the original file name.
    const name = lastPrompt().prompt["1"]?.inputs.image;
    expect(name).toMatch(/^comfy-[0-9a-f-]+\.png$/);
    expect(h.comfy.uploadMeta.at(-1)?.subfolder).toBe("");
    // The snapshot keeps the stored id, and the result points back at the upload.
    expect(await storedParams(job.id)).toMatchObject({ image: upload.id });
    const result = await alice.get(`/api/images/${(done.imageIds as string[])[0]}`);
    expect(result.body.parentImageId).toBe(upload.id);
  });
});

describe("multi-image inputs at run time", () => {
  it("uploads each reference into the manifest subfolder and hands the graph the list", async () => {
    const one = await uploadPng(alice, "one.png", [10, 20]);
    const two = await uploadPng(alice, "two.png", [30, 40]);
    const job = await submitJob(alice, {
      workflowId: "fixture-refs",
      values: { refs: [one.id, two.id] },
    });
    h.services.worker.start();
    await waitForStatus(alice, job.id, "done");

    expect(h.comfy.uploadMeta).toHaveLength(2);
    for (const meta of h.comfy.uploadMeta) {
      expect(meta.subfolder).toBe("comfy");
      expect(meta.filename).toMatch(/^comfy-[0-9a-f-]+\.png$/);
    }
    const state = String(lastPrompt().prompt["5"]?.inputs.media_state);
    for (const meta of h.comfy.uploadMeta) expect(state).toContain(`comfy/${meta.filename}`);
    expect(state).toContain("one.png");
    expect(state).toContain("two.png");
    expect(state).not.toContain(one.id);

    expect(await storedParams(job.id)).toMatchObject({ refs: [one.id, two.id] });
  });

  it("fails cleanly when an input vanished before the job ran", async () => {
    const upload = await uploadPng(alice);
    const job = await submitJob(alice, {
      workflowId: "fixture-refs",
      values: { refs: [upload.id] },
    });
    expect((await alice.delete(`/api/images/${upload.id}`)).status).toBe(204);
    h.services.worker.start();
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.noSource);
    expect(h.comfy.submitted).toHaveLength(0);
    expect(h.comfy.uploadMeta).toHaveLength(0);
  });

  it("re-checks ownership in the worker, whatever the stored job says", async () => {
    const theirs = await uploadPng(alice);
    const job = await submitJob(bob, { workflowId: "fixture-refs", values: { refs: [] } });
    await h.services.handle.client.execute({
      sql: "update jobs set params = ? where id = ?",
      args: [JSON.stringify({ refs: [theirs.id] }), job.id],
    });
    h.services.worker.start();
    const failed = await waitForStatus(bob, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.noSource);
    expect(h.comfy.uploadMeta).toHaveLength(0);
  });

  it("caps the combined input size before reading anything", async () => {
    const rows = ["big-1", "big-2"].map((id) => ({
      id,
      jobId: null,
      ownerId: ALICE,
      kind: "image",
      source: "upload",
      fileKey: `missing/${id}.png`,
      mime: "image/png",
      bytes: Math.ceil(UPLOAD_LIMITS.maxJobInputBytes / 2) + 1,
      createdAt: new Date().toISOString(),
    }));
    for (const row of rows) await insertImage(h.services.db, row);
    const job = await submitJob(alice, {
      workflowId: "fixture-refs",
      values: { refs: ["big-1", "big-2"] },
    });
    h.services.worker.start();
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.inputsTooLarge);
  });
});
