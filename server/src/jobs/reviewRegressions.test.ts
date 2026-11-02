import { afterEach, describe, expect, it } from "vitest";
import { insertImage } from "../images/imageRepo.js";
import { asUser } from "../test/asUser.js";
import { ALICE, createHarness, type Harness, makePng, until } from "../test/harness.js";
import { submitJob, TXT2IMG, waitForStatus } from "../test/jobHelpers.js";
import { getJobById, insertJob } from "./jobRepo.js";

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});
async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

describe("review regressions", () => {
  it("never exceeds the per-owner waiting cap under concurrent creations", async () => {
    const h = await setup();
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => h.services.jobs.createJob(ALICE, TXT2IMG)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    holder.release();
  });

  it("a lease release that throws does not turn a finished job into a failure", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const real = h.services.ctx.gate.acquire.bind(h.services.ctx.gate);
    h.services.ctx.gate.acquire = async (options) => {
      const lease = await real(options);
      return {
        release: async () => {
          await lease.release();
          throw new Error("lease file locked");
        },
      };
    };
    const job = await submitJob(alice, TXT2IMG);
    const done = await waitForStatus(alice, job.id, "done");
    expect(done.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await alice.get(`/api/jobs/${job.id}`)).body.status).toBe("done");
  });

  it("a cancel that lands after the outcome is known ends cancelled, not queued", async () => {
    const h = await setup({ retryDelaysMs: [60_000] });
    const alice = asUser(h, ALICE);
    const real = h.services.ctx.gate.acquire.bind(h.services.ctx.gate);
    let jobId = "";
    h.services.ctx.gate.acquire = async (options) => {
      const lease = await real(options);
      return {
        release: async () => {
          void h.services.worker.cancel(jobId);
          await lease.release();
        },
      };
    };
    h.control.offline = true;
    const job = await submitJob(alice, TXT2IMG);
    jobId = job.id;
    await waitForStatus(alice, job.id, "cancelled");
  });

  it("recovery does not duplicate images a crashed attempt already stored", async () => {
    const before = await setup({ start: false });
    const png = await makePng();
    before.comfy.files.set("again.png", { mime: "image/png", bytes: png });
    before.comfy.history.set("prompt-dup", {
      status: { status_str: "success", completed: true },
      outputs: { "9": { images: [{ filename: "again.png", subfolder: "", type: "output" }] } },
    });
    await insertJob(before.services.db, {
      id: "dupjob",
      ownerId: ALICE,
      workflowId: "fixture-txt2img",
      workflowHash: "h",
      params: { prompt: "x", seed: 1 },
      status: "running",
      promptId: "prompt-dup",
      createdAt: new Date().toISOString(),
    });
    const stale = await before.services.ctx.store.write("media", ALICE, png, "png");
    await insertImage(before.services.db, {
      id: "stale-image",
      jobId: "dupjob",
      ownerId: ALICE,
      kind: "image",
      fileKey: stale,
      mime: "image/png",
      bytes: png.byteLength,
      createdAt: new Date().toISOString(),
    });
    await before.services.stop();
    const after = await setup({ dataDir: before.dataDir, comfy: before.comfy });
    const row = await until(async () => {
      const found = await getJobById(after.services.db, "dupjob");
      return found?.status === "done" ? found : undefined;
    });
    const images = await asUser(after, ALICE).get(`/api/jobs/${row.id}`);
    expect(images.body.imageIds).toHaveLength(1);
    expect(images.body.imageIds).not.toContain("stale-image");
  });
});
