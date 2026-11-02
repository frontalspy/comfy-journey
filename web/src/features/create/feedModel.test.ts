import type { AppImage, Job } from "@comfy/shared";
import { describe, expect, it } from "vitest";
import { buildFeed, expectedCount, expectedRatio } from "./feedModel";

const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const job = (id: string, status: Job["status"], createdMinutesAgo: number): Job => ({
  id,
  workflowId: "w",
  status,
  progress: null,
  error: null,
  createdAt: minutesAgo(createdMinutesAgo),
  startedAt: null,
  finishedAt: null,
  imageIds: [],
});

const image = (id: string, jobId: string | null, createdMinutesAgo: number): AppImage => ({
  id,
  jobId,
  kind: "image",
  width: 512,
  height: 512,
  mime: "image/png",
  bytes: 1,
  seed: null,
  nsfw: false,
  favourite: false,
  parentImageId: null,
  createdAt: minutesAgo(createdMinutesAgo),
  promptSummary: "p",
  workflowId: "w",
  source: "generated",
  params: {},
});

describe("buildFeed", () => {
  it("shows a finished job by its images, oldest result first, newest job first", () => {
    const feed = buildFeed(
      [job("a", "done", 60), job("b", "done", 30)],
      [image("b2", "b", 29), image("b1", "b", 30), image("a1", "a", 60)],
      {},
      NOW,
    );
    expect(feed.map((group) => group.jobId)).toEqual(["b", "a"]);
    expect(feed[0]?.images.map((i) => i.id)).toEqual(["b1", "b2"]);
  });

  it("keeps running and queued jobs, and a job whose images have not loaded yet", () => {
    const feed = buildFeed(
      [job("run", "running", 1), job("fresh", "done", 1), job("old", "done", 600)],
      [],
      {},
      NOW,
    );
    expect(feed.map((group) => group.jobId)).toEqual(["run", "fresh"]);
  });

  it("shows recent failures but not day-old ones", () => {
    const feed = buildFeed([job("f1", "failed", 60), job("f2", "failed", 60 * 30)], [], {}, NOW);
    expect(feed.map((group) => group.jobId)).toEqual(["f1"]);
  });

  it("ignores images with no job", () => {
    expect(buildFeed([], [image("u", null, 1)], {}, NOW)).toEqual([]);
  });
});

describe("placeholders", () => {
  it("derives count and ratio from the request, defaulting safely", () => {
    const meta = { workflowId: "w", prompt: "", values: { batch: 4, width: 1536, height: 1024 } };
    expect(expectedCount(meta)).toBe(4);
    expect(expectedRatio(meta)).toBeCloseTo(1.5);
    expect(expectedCount(undefined)).toBe(1);
    expect(expectedRatio(undefined)).toBe(1);
  });
});
