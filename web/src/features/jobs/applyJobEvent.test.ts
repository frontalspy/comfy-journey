import type { Job } from "@comfy/shared";
import { describe, expect, it } from "vitest";
import { applyJobEvent } from "./applyJobEvent";

const job: Job = {
  id: "j1",
  workflowId: "w",
  status: "queued",
  progress: null,
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  imageIds: [],
};

describe("applyJobEvent", () => {
  it("updates status and progress", () => {
    const running = applyJobEvent([job], { type: "status", jobId: "j1", status: "running" });
    expect(running.jobs[0]?.status).toBe("running");
    const half = applyJobEvent(running.jobs, { type: "progress", jobId: "j1", progress: 0.5 });
    expect(half.jobs[0]?.progress).toBe(0.5);
  });

  it("collects images once and finishes on done", () => {
    const first = applyJobEvent([job], { type: "image", jobId: "j1", imageId: "a" });
    const again = applyJobEvent(first.jobs, { type: "image", jobId: "j1", imageId: "a" });
    expect(again.jobs[0]?.imageIds).toEqual(["a"]);
    const done = applyJobEvent(again.jobs, { type: "done", jobId: "j1", imageIds: ["a", "b"] });
    expect(done.jobs[0]).toMatchObject({ status: "done", progress: 1, imageIds: ["a", "b"] });
  });

  it("marks a failure with its message", () => {
    const failed = applyJobEvent([job], { type: "error", jobId: "j1", message: "boom" });
    expect(failed.jobs[0]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("reports an unknown job without changing the list", () => {
    const result = applyJobEvent([job], { type: "progress", jobId: "other", progress: 0.1 });
    expect(result.known).toBe(false);
    expect(result.jobs).toEqual([job]);
  });
});
