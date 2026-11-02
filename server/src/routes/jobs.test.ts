import { afterEach, describe, expect, it } from "vitest";
import { LIMITS } from "../limits.js";
import { asUser } from "../test/asUser.js";
import { ALICE, BOB, createHarness, type Harness } from "../test/harness.js";
import { runToDone, submitJob, TXT2IMG } from "../test/jobHelpers.js";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  harness = await createHarness(options);
  return harness;
}

describe("viewer, system and workflows", () => {
  it("returns the verified identity", async () => {
    const h = await setup();
    expect((await asUser(h, ALICE).get("/api/viewer")).body).toEqual({ id: ALICE });
  });

  it("lists public workflows without node targets", async () => {
    const h = await setup();
    const res = await asUser(h, ALICE).get("/api/workflows");
    expect(res.status).toBe(200);
    expect(res.body.map((w: { id: string }) => w.id)).toContain("fixture-txt2img");
    expect(JSON.stringify(res.body)).not.toMatch(/"target"|nodeId/);
    expect(res.body.every((w: { available: boolean }) => w.available)).toBe(true);
  });

  it("marks a workflow unavailable with its reason when ComfyUI lacks a node, and refuses to queue it", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    delete (h.comfy.objectInfo as Record<string, unknown>).KSampler;
    const refreshed = await alice.post("/api/workflows/refresh");
    const text2img = refreshed.body.find((w: { id: string }) => w.id === "fixture-txt2img");
    expect(text2img.available).toBe(false);
    expect(text2img.unavailableReason).toEqual(expect.any(String));
    expect((await alice.post("/api/jobs").send(TXT2IMG)).status).toBe(409);
  });

  it("hides nsfw workflows server-side when they are not allowed", async () => {
    const h = await setup({ allowNsfw: false });
    const alice = asUser(h, ALICE);
    const ids = (await alice.get("/api/workflows")).body.map((w: { id: string }) => w.id);
    expect(ids).not.toContain("fixture-nsfw");
    const res = await alice.post("/api/jobs").send({ workflowId: "fixture-nsfw", values: {} });
    expect(res.status).toBe(400);
  });

  it("reports the queue without revealing who or what is in it", async () => {
    const h = await setup({ start: false });
    await submitJob(asUser(h, ALICE), { ...TXT2IMG, values: { prompt: "secret plan" } });
    const res = await asUser(h, BOB).get("/api/system");
    expect(res.body).toEqual({ comfyui: "up", queueLength: 1, gpuQueue: [] });
  });
});

describe("creating jobs", () => {
  it("validates against the workflow manifest", async () => {
    const h = await setup({ start: false });
    const alice = asUser(h, ALICE);
    const post = (body: object) => alice.post("/api/jobs").send(body);
    expect((await post({ workflowId: "nope", values: {} })).status).toBe(400);
    expect((await post({ workflowId: "fixture-txt2img" })).status).toBe(400);
    expect((await post({ workflowId: "fixture-txt2img", values: { steps: 9999 } })).status).toBe(
      400,
    );
    expect((await post({ workflowId: "fixture-txt2img", values: { nodeId: "3" } })).status).toBe(
      400,
    );
    const tooLong = "x".repeat(LIMITS.maxPromptLength + 1);
    expect(
      (await post({ workflowId: "fixture-txt2img", values: { prompt: tooLong } })).status,
    ).toBe(400);
    const bad = await post({
      workflowId: "fixture-txt2img",
      values: { width: 2048, height: 2048, batch: 9 },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.issues).toEqual(expect.any(Array));
  });

  it("answers 202 with the queued job and applies defaults to the stored snapshot", async () => {
    const h = await setup({ start: false });
    const res = await asUser(h, ALICE)
      .post("/api/jobs")
      .send({
        workflowId: "fixture-txt2img",
        values: { prompt: "hello" },
      });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: "queued",
      workflowId: "fixture-txt2img",
      imageIds: [],
    });
    const stored = await h.services.handle.client.execute("select params, workflow_hash from jobs");
    expect(JSON.parse(String(stored.rows[0]?.params))).toMatchObject({
      prompt: "hello",
      steps: 20,
    });
    expect(String(stored.rows[0]?.workflow_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("caps each owner's waiting jobs without affecting other users", async () => {
    const h = await setup({ start: false });
    const alice = asUser(h, ALICE);
    for (let i = 0; i < LIMITS.maxWaitingJobsPerOwner; i++) await submitJob(alice);
    const over = await alice.post("/api/jobs").send(TXT2IMG);
    expect(over.status).toBe(429);
    expect((await asUser(h, BOB).post("/api/jobs").send(TXT2IMG)).status).toBe(202);
    const cancelled = await alice.get("/api/jobs?status=queued");
    await alice.post(`/api/jobs/${cancelled.body[0].id}/cancel`);
    expect((await alice.post("/api/jobs").send(TXT2IMG)).status).toBe(202);
  });

  it("rate limits job creation per owner", async () => {
    const h = await setup({ start: false });
    const alice = asUser(h, ALICE);
    for (let i = 0; i < LIMITS.jobCreateRateLimit.hits; i++) h.services.limiter.tryHit(ALICE);
    const limited = await alice.post("/api/jobs").send(TXT2IMG);
    expect(limited.status).toBe(429);
    expect((await asUser(h, BOB).post("/api/jobs").send(TXT2IMG)).status).toBe(202);
  });

  it("lists a user's jobs newest first, with the finished job's image ids", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const first = await runToDone(alice);
    const second = await runToDone(alice);
    const list = await alice.get("/api/jobs");
    expect(list.body.map((j: { id: string }) => j.id)).toEqual([second.id, first.id]);
    expect(list.body[1].imageIds).toEqual(first.imageIds);
    expect((await alice.get("/api/jobs?status=nonsense")).status).toBe(400);
  });
});
