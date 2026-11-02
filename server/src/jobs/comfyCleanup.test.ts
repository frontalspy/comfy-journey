import { afterEach, describe, expect, it } from "vitest";
import { asUser } from "../test/asUser.js";
import {
  ALICE,
  createHarness,
  type Harness,
  makePng,
  scriptSuccess,
  until,
} from "../test/harness.js";
import { submitJob, waitForStatus } from "../test/jobHelpers.js";
import { uploadPng } from "../test/uploadHelpers.js";
import { getJobById, insertJob } from "./jobRepo.js";

const TOKEN = "cleanup-token-for-tests-0123456789";
const closers: Harness[] = [];
afterEach(async () => {
  for (const h of closers.splice(0)) await h.close();
});

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const h = await createHarness({ cleanupToken: TOKEN, ...options });
  closers.push(h);
  return h;
}

const executingDone = (promptId: string) => ({
  type: "executing",
  data: { node: null, prompt_id: promptId },
});

const failingRun = (promptId: string) => [
  { type: "execution_error", data: { prompt_id: promptId, node_id: "3" } },
];

describe("ComfyUI cleanup after a job", () => {
  it("deletes exactly the files it collected, with the bearer token, after the job is done", async () => {
    const h = await setup();
    const png = await makePng();
    h.comfy.files.set("final.png", { mime: "image/png", bytes: png });
    h.comfy.files.set("preview.png", { mime: "image/png", bytes: png });
    h.comfy.runScript = (promptId) => {
      h.comfy.history.set(promptId, {
        status: { status_str: "success", completed: true },
        outputs: {
          "9": { images: [{ filename: "final.png", subfolder: "run", type: "output" }] },
          "12": {
            images: [
              { filename: "preview.png", subfolder: "", type: "temp" },
              { filename: "seen.png", subfolder: "", type: "input" },
            ],
          },
        },
      });
      return [executingDone(promptId)];
    };
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "done");
    await until(() => h.comfy.cleanups.length > 0);

    expect(h.comfy.cleanups).toHaveLength(1);
    expect(h.comfy.cleanups[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.comfy.cleanups[0]?.files).toEqual([
      { filename: "final.png", subfolder: "run", type: "output" },
      { filename: "preview.png", subfolder: "", type: "temp" },
    ]);
  });

  it("does not delete anything when the job fails before storing", async () => {
    const h = await setup();
    h.comfy.runScript = failingRun;
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "failed");
    expect(h.comfy.cleanups).toHaveLength(0);
  });

  it("does not delete outputs that could not be stored", async () => {
    const h = await setup();
    h.comfy.runScript = (promptId) => {
      h.comfy.history.set(promptId, {
        status: { status_str: "success", completed: true },
        outputs: { "9": { images: [{ filename: "gone.png", subfolder: "", type: "output" }] } },
      });
      return [executingDone(promptId)];
    };
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "failed");
    expect(h.comfy.cleanups).toHaveLength(0);
  });

  it("is off without a token: no request is made and nothing changes", async () => {
    const h = await createHarness();
    closers.push(h);
    h.comfy.cleanupToken = TOKEN;
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "done");
    expect(h.comfy.cleanups).toHaveLength(0);
    expect(h.warnings).toEqual([]);
  });

  it.each([
    ["an older ComfyUI without the extension (404)", { cleanupRoute: false }, "404"],
    ["a disabled extension (503)", { cleanupToken: undefined }, "503"],
    ["a wrong token (401)", { cleanupToken: "another-token-entirely-0123456" }, "401"],
    ["a server error (500)", { cleanupFailWith: 500 }, "500"],
  ])("only warns for %s", async (_name, change, status) => {
    const h = await setup();
    Object.assign(h.comfy, change);
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    const done = await waitForStatus(alice, job.id, "done");
    expect(done.error).toBeNull();
    const warning = await until(() => h.warnings.find((w) => w.includes("[cleanup]")));
    expect(warning).toContain(status);
    expect(warning).not.toContain("out-0");
    expect(warning).not.toContain(TOKEN);
    expect(h.comfy.cleanups).toHaveLength(0);
  });

  it("only warns when cleanup times out, and the job is still done", async () => {
    const h = await setup({ cleanupTimeoutMs: 100 });
    h.comfy.cleanupHang = true;
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "done");
    const warning = await until(() => h.warnings.find((w) => w.includes("[cleanup]")));
    expect(warning).toContain("timeout");
  });

  it("keeps file names out of API responses and job errors", async () => {
    const h = await setup();
    h.comfy.cleanupFailWith = 500;
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    const done = await waitForStatus(alice, job.id, "done");
    expect(JSON.stringify(done)).not.toContain("out-0.png");
    expect(JSON.stringify(done)).not.toContain(TOKEN);
    const list = await alice.get("/api/images");
    expect(JSON.stringify(list.body)).not.toContain("out-0.png");
  });

  it("cleans up after a recovery re-collect too", async () => {
    const before = await createHarness({ start: false, cleanupToken: TOKEN });
    closers.push(before);
    before.comfy.files.set("recovered.png", { mime: "image/png", bytes: await makePng() });
    before.comfy.history.set("prompt-77", {
      status: { status_str: "success", completed: true },
      outputs: { "9": { images: [{ filename: "recovered.png", subfolder: "", type: "output" }] } },
    });
    await insertJob(before.services.db, {
      id: "job1",
      ownerId: ALICE,
      workflowId: "fixture-txt2img",
      workflowHash: "hash",
      params: { prompt: "recovered", seed: 5 },
      status: "running",
      promptId: "prompt-77",
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    });
    await before.services.stop();
    const after = await createHarness({
      dataDir: before.dataDir,
      comfy: before.comfy,
      cleanupToken: TOKEN,
    });
    closers.push(after);
    await until(async () => (await getJobById(after.services.db, "job1"))?.status === "done");
    await until(() => before.comfy.cleanups.length > 0);
    expect(before.comfy.cleanups[0]?.files).toEqual([
      { filename: "recovered.png", subfolder: "", type: "output" },
    ]);
  });
});

describe("cleanup of staged reference uploads", () => {
  it("deletes only input/comfy uploads when the job ends, not the input root", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const one = await uploadPng(alice, "one.png", [10, 20]);
    const two = await uploadPng(alice, "two.png", [30, 40]);
    const job = await submitJob(alice, {
      workflowId: "fixture-refs",
      values: { refs: [one.id, two.id] },
    });
    await waitForStatus(alice, job.id, "done");
    await until(() => h.comfy.cleanups.length >= 2);

    const staged = h.comfy.cleanups.flatMap((c) => c.files).filter((f) => f.type === "input");
    expect(staged).toHaveLength(2);
    for (const file of staged) {
      expect(file.subfolder).toBe("comfy");
      expect(file.filename).toMatch(/^comfy-[0-9a-f-]+\.png$/);
    }
    expect(h.comfy.uploadMeta.map((m) => m.filename).sort()).toEqual(
      staged.map((f) => f.filename).sort(),
    );
  });

  it("also cleans staged uploads when the job fails (outputs stay untouched)", async () => {
    const h = await setup();
    await scriptSuccess(h.comfy);
    h.comfy.runScript = failingRun;
    const alice = asUser(h, ALICE);
    const one = await uploadPng(alice, "one.png", [10, 20]);
    const job = await submitJob(alice, { workflowId: "fixture-refs", values: { refs: [one.id] } });
    await waitForStatus(alice, job.id, "failed");
    await until(() => h.comfy.cleanups.length > 0);
    const all = h.comfy.cleanups.flatMap((c) => c.files);
    expect(all.every((f) => f.type === "input" && f.subfolder === "comfy")).toBe(true);
  });

  it("never sends single-image uploads from the input root", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const upload = await uploadPng(alice, "start.png");
    const job = await submitJob(alice, {
      workflowId: "fixture-img2img",
      values: { image: upload.id },
    });
    await waitForStatus(alice, job.id, "done");
    await until(() => h.comfy.cleanups.length > 0);
    const all = h.comfy.cleanups.flatMap((c) => c.files);
    expect(all.some((f) => f.type === "input")).toBe(false);
  });
});
