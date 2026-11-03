import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openAppDb } from "../db/client.js";
import { images, jobs } from "../db/schema.js";
import { listOwnedImages } from "../images/imageRepo.js";

// Seeds a throwaway database with many images and times the library queries the web app makes.
// `npm run bench --workspace=server` (optionally with a count, default 10000). Budget: p95 < 100 ms.
const COUNT = Number(process.argv[2] ?? 10_000);
const RUNS = 200;
const BUDGET_MS = 100;
const OWNER = "bench-user";
const WORDS = ["lighthouse", "forest", "portrait", "city", "dragon", "ocean", "desert", "castle"];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-bench-"));
const handle = await openAppDb(root);
const { db } = handle;

const start = Date.parse("2026-01-01T00:00:00Z");
const jobRows = [];
const imageRows = [];
for (let index = 0; index < COUNT; index += 1) {
  const createdAt = new Date(start + index * 60_000).toISOString();
  const jobId = `job-${index}`;
  jobRows.push({
    id: jobId,
    ownerId: OWNER,
    workflowId: `workflow-${index % 4}`,
    workflowHash: "bench",
    params: { prompt: "bench" },
    status: "done",
    createdAt,
  });
  imageRows.push({
    id: `image-${index}`,
    jobId,
    ownerId: OWNER,
    kind: index % 10 === 0 ? "video" : "image",
    source: "generated",
    fileKey: `media/${index}.png`,
    thumbKey: `thumbs/${index}.webp`,
    width: 1024,
    height: 1024,
    mime: "image/png",
    bytes: 1_000_000,
    favourite: index % 20 === 0,
    promptSummary: `${WORDS[index % WORDS.length]} ${WORDS[(index * 7) % WORDS.length]} number ${index}`,
    createdAt,
  });
}
for (let offset = 0; offset < COUNT; offset += 500) {
  await db.insert(jobs).values(jobRows.slice(offset, offset + 500));
  await db.insert(images).values(imageRows.slice(offset, offset + 500));
}

async function time(label: string, run: () => Promise<unknown>): Promise<boolean> {
  const samples: number[] = [];
  for (let attempt = 0; attempt < RUNS; attempt += 1) {
    const began = performance.now();
    await run();
    samples.push(performance.now() - began);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const ok = p95 < BUDGET_MS;
  console.log(
    `${ok ? "ok  " : "SLOW"} ${label.padEnd(34)} median ${median.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms`,
  );
  return ok;
}

const base = { source: "generated" as const, limit: 40 };
const firstPage = await listOwnedImages(db, OWNER, base);
const deep = await (async () => {
  let cursor = firstPage.nextCursor;
  for (let page = 0; page < Math.min(100, COUNT / 40 - 2); page += 1) {
    const next = await listOwnedImages(db, OWNER, { ...base, cursor: cursor ?? undefined });
    cursor = next.nextCursor;
  }
  return cursor ?? undefined;
})();

console.log(`${COUNT} images in a fresh database\n`);
const results = [
  await time("first page", () => listOwnedImages(db, OWNER, base)),
  await time("page 100 (cursor)", () => listOwnedImages(db, OWNER, { ...base, cursor: deep })),
  await time("videos only", () => listOwnedImages(db, OWNER, { ...base, kind: "video" })),
  await time("favourites only", () => listOwnedImages(db, OWNER, { ...base, favourite: "true" })),
  await time("one workflow", () =>
    listOwnedImages(db, OWNER, { ...base, workflowId: "workflow-2" }),
  ),
  await time("search: common word", () =>
    listOwnedImages(db, OWNER, { ...base, search: "forest" }),
  ),
  await time("search: rare word", () =>
    listOwnedImages(db, OWNER, { ...base, search: "number 9876" }),
  ),
];
handle.client.close();
try {
  fs.rmSync(root, { recursive: true, force: true });
} catch {
  // Windows can keep the database file locked a moment after closing; the OS temp folder cleans up.
}
process.exit(results.every(Boolean) ? 0 : 1);
