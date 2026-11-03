import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeComfy,
  executingFrame,
  type FakeComfy,
  progressFrame,
} from "../test/fakeComfy.js";
import { collectOutputFiles, createComfyClient } from "./client.js";
import { ComfyError, isTransient } from "./errors.js";
import type { ComfyEvent, ComfyWorkflow } from "./types.js";

const workflow: ComfyWorkflow = { "1": { class_type: "KSampler", inputs: { seed: 1 } } };

let active: FakeComfy | undefined;
afterEach(async () => {
  await active?.close();
  active = undefined;
});

async function setup(options: { idleTimeoutMs?: number; requestTimeoutMs?: number } = {}) {
  const fake = await createFakeComfy();
  active = fake;
  return { fake, client: createComfyClient({ baseUrl: fake.url, ...options }) };
}

async function collect(iterator: AsyncGenerator<ComfyEvent>): Promise<ComfyEvent[]> {
  const events: ComfyEvent[] = [];
  for await (const event of iterator) events.push(event);
  return events;
}

describe("submit and watch", () => {
  it("submits the graph with a client id and returns the prompt id", async () => {
    const { fake, client } = await setup();
    const { promptId } = await client.submit(workflow);
    expect(promptId).toBe("prompt-1");
    expect(fake.submitted[0]).toMatchObject({ prompt: workflow, client_id: expect.any(String) });
  });

  it("streams progress, executing and done, then ends", async () => {
    const { fake, client } = await setup();
    fake.runScript = (id) => [
      executingFrame(id, "3"),
      progressFrame(id, 1, 2),
      progressFrame(id, 2, 2),
      { type: "executed", data: { node: "9", output: { images: [] }, prompt_id: id } },
      // A frame for another run must be ignored.
      progressFrame("someone-else", 1, 1),
      executingFrame(id, null),
    ];
    const { promptId } = await client.submit(workflow);
    const events = await collect(client.watch(promptId));
    expect(events.map((e) => e.type)).toEqual([
      "executing",
      "progress",
      "progress",
      "executed",
      "done",
    ]);
    expect(events[2]).toMatchObject({ value: 2, max: 2 });
  });

  it("surfaces an execution error and interruption as terminal events", async () => {
    const { fake, client } = await setup();
    fake.runScript = (id) => [
      {
        type: "execution_error",
        data: { prompt_id: id, node_id: "3", exception_message: "/secret/path" },
      },
    ];
    const { promptId } = await client.submit(workflow);
    const events = await collect(client.watch(promptId));
    expect(events).toEqual([{ type: "error", message: "Execution failed in node 3", nodeId: "3" }]);

    fake.runScript = () => [{ type: "execution_interrupted", data: {} }];
    const second = await client.submit(workflow);
    expect(await collect(client.watch(second.promptId))).toEqual([{ type: "interrupted" }]);
  });

  it("fails with unreachable when the socket drops mid-run", async () => {
    const { fake, client } = await setup();
    fake.runScript = (id) => [progressFrame(id, 1, 4)];
    fake.disconnectAfterScript = true;
    const { promptId } = await client.submit(workflow);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of client.watch(promptId)) seen.push(event.type);
      })(),
    ).rejects.toMatchObject({ kind: "unreachable" });
    expect(seen).toContain("progress");
  });

  it("ends from history when the run finished before the socket opened", async () => {
    const { fake, client } = await setup();
    fake.runScript = () => [];
    fake.history.set("prompt-1", {
      status: { completed: true, status_str: "success" },
      outputs: {},
    });
    const { promptId } = await client.submit(workflow);
    expect(await collect(client.watch(promptId))).toEqual([{ type: "done" }]);
  });

  it("times out when the socket goes silent", async () => {
    const { fake, client } = await setup({ idleTimeoutMs: 100 });
    fake.runScript = () => [];
    const { promptId } = await client.submit(workflow);
    await expect(collect(client.watch(promptId))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("keeps waiting through a long silent step while ComfyUI still has the run", async () => {
    const { fake, client } = await setup({ idleTimeoutMs: 50 });
    fake.runScript = () => [];
    const { promptId } = await client.submit(workflow);
    fake.queueRunning = [promptId];
    setTimeout(() => {
      fake.queueRunning = [];
      fake.history.set(promptId, {
        status: { completed: true, status_str: "success" },
        outputs: {},
      });
    }, 300);
    expect(await collect(client.watch(promptId))).toEqual([{ type: "done" }]);
  });

  it("stops quietly when aborted", async () => {
    const { fake, client } = await setup();
    fake.runScript = () => [];
    const { promptId } = await client.submit(workflow);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await collect(client.watch(promptId, controller.signal))).toEqual([]);
  });
});

describe("the other endpoints", () => {
  it("reads history and collects output files", async () => {
    const { fake, client } = await setup();
    fake.history.set("p", {
      status: { completed: true, status_str: "success" },
      outputs: { "9": { images: [{ filename: "a.png", subfolder: "", type: "output" }] } },
    });
    const entry = await client.history("p");
    expect(entry).toMatchObject({ completed: true, statusStr: "success" });
    expect(collectOutputFiles(entry ?? { completed: false, statusStr: "", outputs: {} })).toEqual([
      { filename: "a.png", subfolder: "", type: "output" },
    ]);
    expect(await client.history("missing")).toBeNull();
  });

  it("fetches an output through /view", async () => {
    const { fake, client } = await setup();
    fake.files.set("a.png", { mime: "image/png", bytes: Buffer.from([1, 2, 3]) });
    const out = await client.fetchOutput({ filename: "a.png", subfolder: "", type: "output" });
    expect(out.mime).toBe("image/png");
    expect([...out.bytes]).toEqual([1, 2, 3]);
    await expect(
      client.fetchOutput({ filename: "nope.png", subfolder: "", type: "output" }),
    ).rejects.toMatchObject({ kind: "http", status: 404 });
  });

  it("interrupts, frees, and reads object_info and system stats", async () => {
    const { fake, client } = await setup();
    fake.objectInfo = { KSampler: { input: { required: {} } } };
    await client.interrupt();
    await client.free({ unloadModels: true, freeMemory: true });
    expect(fake.interrupts).toBe(1);
    expect(fake.frees).toEqual([{ unload_models: true, free_memory: true }]);
    expect(Object.keys(await client.objectInfo())).toEqual(["KSampler"]);
    expect((await client.systemStats()).devices).toHaveLength(1);
  });

  it("uploads an image as multipart", async () => {
    const { fake, client } = await setup();
    const result = await client.uploadImage({ bytes: new Uint8Array([9, 9]), filename: "in.png" });
    expect(result).toEqual({ name: "in.png", subfolder: "", type: "input" });
    expect(fake.uploads[0]).toContain('filename="in.png"');
  });
});

describe("errors", () => {
  it("classifies unreachable, timeout and http failures", async () => {
    const { fake, client } = await setup({ requestTimeoutMs: 100 });
    fake.failNextWith = 503;
    const http = await client.systemStats().catch((e: unknown) => e);
    expect(http).toBeInstanceOf(ComfyError);
    expect(http).toMatchObject({ kind: "http", status: 503 });
    expect(isTransient(http)).toBe(true);

    fake.hangNext = true;
    const slow = await client.systemStats().catch((e: unknown) => e);
    expect(slow).toMatchObject({ kind: "timeout" });
    expect(isTransient(slow)).toBe(true);

    const url = fake.url;
    await fake.close();
    active = undefined;
    const down = await createComfyClient({ baseUrl: url })
      .systemStats()
      .catch((e: unknown) => e);
    expect(down).toMatchObject({ kind: "unreachable" });
    expect(isTransient(down)).toBe(true);
  });

  it("treats 4xx and execution errors as permanent", () => {
    expect(isTransient(new ComfyError("http", "bad", { status: 400 }))).toBe(false);
    expect(isTransient(new ComfyError("execution", "boom"))).toBe(false);
    expect(isTransient(new Error("other"))).toBe(false);
  });
});

describe("deleteOutputs", () => {
  const ref = (n: number) => ({ filename: `f${n}.png`, subfolder: "", type: "output" });

  it("is disabled and silent without a token", async () => {
    const { fake, client } = await setup();
    expect(client.cleanupEnabled).toBe(false);
    expect(await client.deleteOutputs([ref(1)])).toEqual({ deleted: 0, missing: 0, refused: 0 });
    expect(fake.cleanups).toHaveLength(0);
  });

  it("sends the bearer token and splits big lists into requests of 64", async () => {
    const fake = await createFakeComfy();
    active = fake;
    fake.cleanupToken = "a-long-enough-token-1234567";
    const client = createComfyClient({ baseUrl: fake.url, cleanupToken: fake.cleanupToken });
    const result = await client.deleteOutputs(Array.from({ length: 70 }, (_, i) => ref(i)));
    expect(result.deleted).toBe(70);
    expect(fake.cleanups.map((c) => c.files.length)).toEqual([64, 6]);
    expect(fake.cleanups[0]?.authorization).toBe(`Bearer ${fake.cleanupToken}`);
  });

  it("throws a typed ComfyError for a missing extension", async () => {
    const fake = await createFakeComfy();
    active = fake;
    fake.cleanupRoute = false;
    const client = createComfyClient({
      baseUrl: fake.url,
      cleanupToken: "a-long-enough-token-1234567",
    });
    await expect(client.deleteOutputs([ref(1)])).rejects.toMatchObject({
      kind: "http",
      status: 404,
    });
  });
});
