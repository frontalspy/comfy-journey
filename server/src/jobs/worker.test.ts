import { afterEach, describe, expect, it } from "vitest";
import { asUser, type UserClient } from "../test/asUser.js";
import { progressFrame } from "../test/fakeComfy.js";
import { ALICE, BOB, createHarness, type Harness, scriptSuccess, until } from "../test/harness.js";
import { runToDone, submitJob, TXT2IMG, waitForStatus } from "../test/jobHelpers.js";
import { MESSAGES } from "./jobFailure.js";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  harness = await createHarness(options);
  return harness;
}

type Submitted = { prompt: Record<string, { inputs: { text?: string } }> };
const promptTexts = (h: Harness): unknown[] =>
  h.comfy.submitted.map((entry) => (entry as Submitted).prompt["6"]?.inputs.text);

describe("worker ordering and single flight", () => {
  it("runs the oldest job first across users, one at a time", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const bob = asUser(h, BOB);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });

    const first = await submitJob(alice, { ...TXT2IMG, values: { prompt: "first" } });
    await waitForStatus(alice, first.id, "waiting_for_gpu");
    const second = await submitJob(bob, { ...TXT2IMG, values: { prompt: "second" } });
    const third = await submitJob(alice, { ...TXT2IMG, values: { prompt: "third" } });
    // Only the claimed job waits for the GPU; the others stay queued behind it.
    expect((await bob.get(`/api/jobs/${second.id}`)).body.status).toBe("queued");

    let maxActive = 0;
    const sampler = setInterval(() => {
      void h.services.handle.client
        .execute("select count(*) as n from jobs where status in ('running','waiting_for_gpu')")
        .then((result) => {
          maxActive = Math.max(maxActive, Number(result.rows[0]?.n ?? 0));
        });
    }, 2);
    holder.release();
    await waitForStatus(bob, second.id, "done");
    await waitForStatus(alice, third.id, "done");
    clearInterval(sampler);

    expect(promptTexts(h)).toEqual(["first", "second", "third"]);
    expect(maxActive).toBeLessThanOrEqual(1);
  });

  it("shows waiting_for_gpu while another app holds the GPU, then runs", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "waiting_for_gpu");
    expect(h.comfy.submitted).toHaveLength(0);
    const system = await alice.get("/api/system");
    expect(system.body.gpuQueue).toEqual([
      { app: "other-app", position: 0 },
      { app: "comfy", position: 1 },
    ]);
    expect(system.body.queueLength).toBe(1);
    holder.release();
    await waitForStatus(alice, job.id, "done");
  });
});

describe("worker and ComfyUI availability", () => {
  it("stays queued with growing backoff while ComfyUI is down, then runs", async () => {
    let resume: () => void = () => undefined;
    const firstBackoff = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const h = await setup({
      retryDelaysMs: [10, 20, 30],
      onDelay: async () => {
        if (harness?.delays.length === 1) await firstBackoff;
        if (harness?.delays.length === 2) harness.control.offline = false;
      },
    });
    const alice = asUser(h, ALICE);
    h.control.offline = true;
    const job = await submitJob(alice);
    await until(() => h.delays.length >= 1);
    expect((await alice.get(`/api/jobs/${job.id}`)).body.status).toBe("queued");
    expect((await alice.get("/api/system")).body.comfyui).toBe("offline");
    resume();
    await waitForStatus(alice, job.id, "done");
    expect(h.delays.slice(0, 2)).toEqual([10, 20]);
    expect((await alice.get("/api/system")).body.comfyui).toBe("up");
  });

  it("retries a transient submit failure and still finishes", async () => {
    const h = await setup({ retryDelaysMs: [7, 7, 7] });
    const alice = asUser(h, ALICE);
    h.control.failSubmits = 1;
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "done");
    expect(h.delays).toContain(7);
    expect(h.comfy.submitted).toHaveLength(1);
  });

  it("gives up after the retry delays are used and says so plainly", async () => {
    const h = await setup({ retryDelaysMs: [1, 1] });
    const alice = asUser(h, ALICE);
    h.control.failSubmits = 99;
    const job = await submitJob(alice);
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.unavailable);
  });
});

describe("failures", () => {
  it("fails with a sanitised message, never ComfyUI internals or paths", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    h.comfy.runScript = (promptId) => [
      {
        type: "execution_error",
        data: {
          prompt_id: promptId,
          node_id: "3",
          exception_message:
            "CUDA OOM at C:\\models\\secret\\anima.safetensors /srv/comfy/nodes.py",
        },
      },
    ];
    const job = await submitJob(alice);
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.failed);
    const serialized = JSON.stringify(failed);
    for (const leak of ["secret", "CUDA", "safetensors", "nodes.py", "node 3"]) {
      expect(serialized).not.toContain(leak);
    }
    expect(h.comfy.frees).toHaveLength(1);
  });

  it("fails a job whose run produced nothing usable", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    h.comfy.runScript = (promptId) => {
      h.comfy.history.set(promptId, {
        status: { status_str: "success", completed: true },
        outputs: {},
      });
      return [{ type: "executing", data: { node: null, prompt_id: promptId } }];
    };
    const job = await submitJob(alice);
    const failed = await waitForStatus(alice, job.id, "failed");
    expect(failed.error).toBe(MESSAGES.noOutput);
  });
});

describe("GPU lease and memory", () => {
  it("asks ComfyUI to free its models before the lease is released", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const events: string[] = [];
    const acquire = h.gate.acquire.bind(h.gate);
    h.gate.acquire = async (options) => {
      const lease = await acquire(options);
      return {
        release: () => {
          events.push(`release after ${h.comfy.frees.length} free calls`);
          return lease.release();
        },
      };
    };
    await runToDone(alice);
    expect(events).toEqual(["release after 1 free calls"]);
    expect(h.comfy.frees).toEqual([{ unload_models: true, free_memory: true }]);
    expect(await h.gate.status()).toEqual([]);
  });

  it("releases the lease when the run fails", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    h.comfy.runScript = (promptId) => [
      { type: "execution_error", data: { prompt_id: promptId, node_id: "3" } },
    ];
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "failed");
    expect(await h.gate.status()).toEqual([]);
  });
});

describe("progress", () => {
  it("writes monotonic, throttled progress", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    await scriptSuccess(h.comfy, {
      frames: (promptId) =>
        Array.from({ length: 100 }, (_, index) => progressFrame(promptId, index + 1, 100)),
    });
    const seen: number[] = [];
    const publish = h.services.ctx.bus.publish.bind(h.services.ctx.bus);
    h.services.ctx.bus.publish = (event) => {
      if (event.type === "progress") seen.push(event.progress);
      publish(event);
    };
    await runToDone(alice);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.length).toBeLessThan(60);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(Math.max(...seen)).toBeLessThan(1);
  });
});

describe("cancel", () => {
  const cancelOne = (client: UserClient, id: string) => client.post(`/api/jobs/${id}/cancel`);

  it("cancels a queued job directly, without it ever reaching ComfyUI", async () => {
    const h = await setup({ start: false });
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    const res = await cancelOne(alice, job.id);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.finishedAt).not.toBeNull();
    expect((await cancelOne(alice, job.id)).body.status).toBe("cancelled");
    expect(h.comfy.submitted).toHaveLength(0);
  });

  it("aborts the GPU wait when a waiting job is cancelled", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "waiting_for_gpu");
    const res = await cancelOne(alice, job.id);
    expect(res.body.status).toBe("cancelled");
    expect(await h.gate.status()).toEqual([{ app: "other-app", position: 0 }]);
    holder.release();
    expect(h.comfy.submitted).toHaveLength(0);
  });

  it("interrupts a running job and ends it cancelled", async () => {
    const h = await setup();
    const alice = asUser(h, ALICE);
    h.comfy.runScript = (promptId) => [progressFrame(promptId, 1, 10)];
    const job = await submitJob(alice);
    await until(async () => {
      const result = await h.services.handle.client.execute("select prompt_id from jobs");
      return result.rows[0]?.prompt_id;
    });
    const res = await cancelOne(alice, job.id);
    expect(res.body.status).toBe("cancelled");
    expect(h.comfy.interrupts).toBe(1);
    expect(h.comfy.frees).toHaveLength(1);
    expect(await h.gate.status()).toEqual([]);
    expect((await alice.get("/api/images")).body.items).toEqual([]);
  });
});
