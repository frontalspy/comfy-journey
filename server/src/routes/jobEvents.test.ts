import { afterEach, describe, expect, it } from "vitest";
import { asUser } from "../test/asUser.js";
import { ALICE, BOB, createHarness, type Harness, USER_HEADER } from "../test/harness.js";
import { runToDone, submitJob, waitForStatus } from "../test/jobHelpers.js";

let harness: Harness | undefined;
let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  await harness?.close();
  harness = undefined;
});

interface Stream {
  response: Response;
  text(): string;
  /** Resolves once the accumulated text satisfies `predicate`. */
  until(predicate: (text: string) => boolean): Promise<string>;
  /** Resolves when the server ends the stream. */
  ended: Promise<void>;
}

async function openStream(baseUrl: string, jobId: string, user: string): Promise<Stream> {
  // A job id, or a full path such as "/api/events".
  const path = jobId.startsWith("/") ? jobId : `/api/jobs/${jobId}/events`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { [USER_HEADER]: user },
  });
  let buffer = "";
  const waiters: { predicate: (text: string) => boolean; resolve: (text: string) => void }[] = [];
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const ended = (async () => {
    while (reader) {
      // The server closing a stream it never ends itself (GET /api/events) is not a failure.
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (const waiter of [...waiters]) {
        if (waiter.predicate(buffer)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(buffer);
        }
      }
    }
  })();
  return {
    response,
    text: () => buffer,
    until: (predicate) =>
      predicate(buffer)
        ? Promise.resolve(buffer)
        : new Promise((resolve) => waiters.push({ predicate, resolve })),
    ended,
  };
}

const dataEvents = (text: string): { type: string; [key: string]: unknown }[] =>
  text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));

async function start(options: Parameters<typeof createHarness>[0] = {}): Promise<{
  h: Harness;
  baseUrl: string;
}> {
  const h = await createHarness(options);
  harness = h;
  const server = await h.listen();
  closeServer = server.close;
  return { h, baseUrl: server.baseUrl };
}

describe("GET /api/events", () => {
  it("streams only the caller's own jobs", async () => {
    const { h, baseUrl } = await start();
    const aliceStream = await openStream(baseUrl, "/api/events", ALICE);
    const bobStream = await openStream(baseUrl, "/api/events", BOB);
    expect(aliceStream.response.headers.get("content-type")).toContain("text/event-stream");

    const { id } = await runToDone(asUser(h, ALICE));
    const seen = await aliceStream.until((text) => text.includes('"type":"done"'));
    const events = dataEvents(seen);
    expect(events.every((event) => event.jobId === id)).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
    expect(bobStream.text()).not.toContain(id);
  });
});

describe("GET /api/jobs/:id/events", () => {
  it("sends the current state first, then live events, and closes when the job is done", async () => {
    const { h, baseUrl } = await start();
    const alice = asUser(h, ALICE);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "waiting_for_gpu");

    const stream = await openStream(baseUrl, job.id, ALICE);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.response.headers.get("cache-control")).toContain("no-store");
    const first = await stream.until((text) => text.includes("\n\n"));
    expect(dataEvents(first)[0]).toEqual({
      type: "status",
      jobId: job.id,
      status: "waiting_for_gpu",
    });

    holder.release();
    await stream.ended;
    const events = dataEvents(stream.text());
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["status", "image", "done"]),
    );
    expect(events.at(-1)?.type).toBe("done");
    expect(events.find((event) => event.type === "done")?.imageIds).toHaveLength(1);
  });

  it("replays a finished job and closes at once", async () => {
    const { h, baseUrl } = await start();
    const { id, imageIds } = await runToDone(asUser(h, ALICE));
    const stream = await openStream(baseUrl, id, ALICE);
    await stream.ended;
    expect(dataEvents(stream.text())).toEqual([{ type: "done", jobId: id, imageIds }]);
  });

  it("reports a failure as an error event and closes", async () => {
    const { h, baseUrl } = await start();
    h.comfy.runScript = (promptId) => [
      { type: "execution_error", data: { prompt_id: promptId, node_id: "3" } },
    ];
    const alice = asUser(h, ALICE);
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "failed");
    const stream = await openStream(baseUrl, job.id, ALICE);
    await stream.ended;
    const events = dataEvents(stream.text());
    expect(events.at(-1)).toMatchObject({ type: "error", jobId: job.id });
  });

  it("closes a cancelled job's stream", async () => {
    const { h, baseUrl } = await start();
    const alice = asUser(h, ALICE);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "waiting_for_gpu");
    const stream = await openStream(baseUrl, job.id, ALICE);
    await stream.until((text) => text.includes("waiting_for_gpu"));
    await alice.post(`/api/jobs/${job.id}/cancel`);
    await stream.ended;
    expect(dataEvents(stream.text()).at(-1)).toEqual({
      type: "status",
      jobId: job.id,
      status: "cancelled",
    });
    holder.release();
  });

  it("sends a heartbeat comment while nothing happens", async () => {
    const { h, baseUrl } = await start({ heartbeatMs: 15 });
    const alice = asUser(h, ALICE);
    const holder = await h.gate.acquireAs("other-app", { label: "other" });
    const job = await submitJob(alice);
    await waitForStatus(alice, job.id, "waiting_for_gpu");
    const stream = await openStream(baseUrl, job.id, ALICE);
    await stream.until((text) => text.includes(": heartbeat\n\n"));
    holder.release();
    await stream.ended;
  });

  it("answers 404 for someone else's job without opening a stream", async () => {
    const { h, baseUrl } = await start();
    const { id } = await runToDone(asUser(h, ALICE));
    const res = await fetch(`${baseUrl}/api/jobs/${id}/events`, {
      headers: { [USER_HEADER]: BOB },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
