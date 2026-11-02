import { afterEach, describe, expect, it } from "vitest";
import { asUser } from "../test/asUser.js";
import { ALICE, createHarness, type Harness, makePng, until } from "../test/harness.js";
import { MESSAGES } from "./jobFailure.js";
import { getJobById, insertJob, type NewJobRow } from "./jobRepo.js";

const closers: Harness[] = [];
afterEach(async () => {
  for (const h of closers.splice(0)) await h.close();
});

const baseRow = (id: string, over: Partial<NewJobRow>): NewJobRow => ({
  id,
  ownerId: ALICE,
  workflowId: "fixture-txt2img",
  workflowHash: "hash",
  params: { prompt: "recovered", seed: 5 },
  status: "running",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Number(id.replace(/\D/g, "")))).toISOString(),
  ...over,
});

/** Writes rows as a crashed process would have left them, then boots a second instance. */
async function restartWith(rows: NewJobRow[]): Promise<Harness> {
  const before = await createHarness({ start: false });
  for (const row of rows) await insertJob(before.services.db, row);
  await before.services.stop();
  const after = await createHarness({ dataDir: before.dataDir, comfy: before.comfy });
  closers.push(after);
  return after;
}

describe("restart recovery", () => {
  it("collects a run that finished while the service was down", async () => {
    const before = await createHarness({ start: false });
    const png = await makePng();
    before.comfy.files.set("recovered.png", { mime: "image/png", bytes: png });
    before.comfy.history.set("prompt-77", {
      status: { status_str: "success", completed: true },
      outputs: { "9": { images: [{ filename: "recovered.png", subfolder: "", type: "output" }] } },
    });
    await insertJob(before.services.db, baseRow("job1", { promptId: "prompt-77" }));
    await before.services.stop();
    const after = await createHarness({ dataDir: before.dataDir, comfy: before.comfy });
    closers.push(after);

    const row = await until(async () => {
      const found = await getJobById(after.services.db, "job1");
      return found?.status === "done" ? found : undefined;
    });
    expect(row.recoveries).toBe(0);
    const images = await asUser(after, ALICE).get("/api/images");
    expect(images.body.items).toHaveLength(1);
    expect(images.body.items[0].promptSummary).toBe("recovered");
    // Collected from history: nothing was submitted again.
    expect(after.comfy.submitted).toHaveLength(0);
  });

  it("requeues an unknown run once and then runs it again", async () => {
    const after = await restartWith([baseRow("job2", { promptId: "prompt-lost" })]);
    const row = await until(async () => {
      const found = await getJobById(after.services.db, "job2");
      return found?.status === "done" ? found : undefined;
    });
    expect(row.recoveries).toBe(1);
    expect(after.comfy.submitted).toHaveLength(1);
  });

  it("fails a run that was already recovered once", async () => {
    const after = await restartWith([baseRow("job3", { promptId: "prompt-lost", recoveries: 1 })]);
    const row = await until(async () => {
      const found = await getJobById(after.services.db, "job3");
      return found?.status === "failed" ? found : undefined;
    });
    expect(row.error).toBe(MESSAGES.interrupted);
    expect(after.comfy.submitted).toHaveLength(0);
  });

  it("puts a job that was waiting for the GPU back in the queue without using up its retry", async () => {
    const after = await restartWith([baseRow("job4", { status: "waiting_for_gpu" })]);
    const row = await until(async () => {
      const found = await getJobById(after.services.db, "job4");
      return found?.status === "done" ? found : undefined;
    });
    expect(row.recoveries).toBe(0);
  });
});
