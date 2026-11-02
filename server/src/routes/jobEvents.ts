import type { JobEvent, JobStatus } from "@comfy/shared";
import { Router } from "express";
import { NotFoundError } from "../core/kit/index.js";
import { imageIdsForJob } from "../images/imageRepo.js";
import { getOwnedJob, isTerminal, type JobRow } from "../jobs/jobRepo.js";
import type { AppServices } from "../services.js";
import { ownerOf, paramOf } from "./helpers.js";

function endsStream(event: JobEvent): boolean {
  return (
    event.type === "done" ||
    event.type === "error" ||
    (event.type === "status" && isTerminal(event.status))
  );
}

/** The events that describe where a job is right now, for a client that just connected. */
async function currentEvents(services: AppServices, row: JobRow): Promise<JobEvent[]> {
  const status = row.status as JobStatus;
  // done and failed are announced by their own terminal event: a terminal status event ends the stream.
  const events: JobEvent[] =
    status === "done" || status === "failed" ? [] : [{ type: "status", jobId: row.id, status }];
  if (row.progress !== null && !isTerminal(status)) {
    events.push({ type: "progress", jobId: row.id, progress: row.progress });
  }
  if (status === "done") {
    const imageIds = await imageIdsForJob(services.db, row.id);
    events.push({ type: "done", jobId: row.id, imageIds });
  }
  if (status === "failed") {
    events.push({ type: "error", jobId: row.id, message: row.error ?? "Generation failed." });
  }
  return events;
}

export function jobEventRoutes(services: AppServices): Router {
  const router = Router();

  router.get("/jobs/:id/events", async (req, res) => {
    const ownerId = ownerOf(req);
    const jobId = paramOf(req, "id");
    if (!(await getOwnedJob(services.db, ownerId, jobId))) throw new NotFoundError("Job not found");

    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    res.flushHeaders();

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    const send = (event: JobEvent): void => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (endsStream(event)) close();
    };
    // Comment lines keep a proxy's idle timeout from cutting a quiet stream.
    const heartbeat = setInterval(() => {
      if (!closed) res.write(": heartbeat\n\n");
    }, services.heartbeatMs);
    // Subscribe before reading the row so nothing is missed between the two.
    const unsubscribe = services.ctx.bus.subscribe(jobId, send);
    req.on("close", close);

    const row = await getOwnedJob(services.db, ownerId, jobId);
    if (!row) return close();
    for (const event of await currentEvents(services, row)) send(event);
  });
  // One stream for all of the caller's jobs, so the browser holds a single connection.
  router.get("/events", (req, res) => {
    const ownerId = ownerOf(req);
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    res.flushHeaders();

    let closed = false;
    // Ownership is looked up once per job id; a foreign or unknown job is never forwarded.
    const owned = new Map<string, Promise<boolean>>();
    const isMine = (jobId: string): Promise<boolean> => {
      let known = owned.get(jobId);
      if (!known) {
        known = getOwnedJob(services.db, ownerId, jobId).then(
          (row) => Boolean(row),
          () => false,
        );
        owned.set(jobId, known);
      }
      return known;
    };
    // Each event waits for the previous lookup, so one job's events stay in order.
    let chain: Promise<void> = Promise.resolve();
    const unsubscribe = services.ctx.bus.subscribeAll((event) => {
      chain = chain.then(async () => {
        if (closed || !(await isMine(event.jobId))) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    });
    const heartbeat = setInterval(() => {
      if (!closed) res.write(": heartbeat\n\n");
    }, services.heartbeatMs);
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });
  return router;
}
