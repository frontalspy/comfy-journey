import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asUser, type UserClient } from "../test/asUser.js";
import { ALICE, createHarness, type Harness, scriptSuccess } from "../test/harness.js";
import { runToDone, submitJob, waitForStatus } from "../test/jobHelpers.js";

let h: Harness;
let alice: UserClient;
beforeEach(async () => {
  h = await createHarness();
  alice = asUser(h, ALICE);
});
afterEach(async () => {
  await h.close();
});

function mediaFiles(area: "media" | "thumbs"): string[] {
  const root = path.join(h.dataDir, area);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((folder) => fs.readdirSync(path.join(root, folder)));
}

describe("image listing", () => {
  it("pages newest first with a cursor and filters by favourite, kind, nsfw and search", async () => {
    await scriptSuccess(h.comfy, { outputs: 3 });
    const { imageIds } = await runToDone(alice, { prompt: "a lighthouse at dusk" });
    expect(imageIds).toHaveLength(3);
    await runToDone(alice, { prompt: "a quiet harbour" });

    const first = await alice.get("/api/images?limit=2");
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await alice.get(`/api/images?limit=2&cursor=${first.body.nextCursor}`);
    const third = await alice.get(`/api/images?limit=2&cursor=${second.body.nextCursor}`);
    const all = [...first.body.items, ...second.body.items, ...third.body.items];
    expect(new Set(all.map((item: { id: string }) => item.id)).size).toBe(6);
    expect(third.body.nextCursor).toBeNull();
    const times = all.map((item: { createdAt: string }) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    await alice.patch(`/api/images/${imageIds[0]}`).send({ favourite: true });
    const favourites = await alice.get("/api/images?favourite=true");
    expect(favourites.body.items.map((i: { id: string }) => i.id)).toEqual([imageIds[0]]);

    const searched = await alice.get("/api/images?search=lighthouse");
    expect(searched.body.items).toHaveLength(3);
    expect((await alice.get("/api/images?search=100%25")).body.items).toEqual([]);
    expect((await alice.get("/api/images?kind=video")).body.items).toEqual([]);
    expect((await alice.get("/api/images?limit=0")).status).toBe(400);
  });

  it("flags images from an nsfw workflow and filters on it", async () => {
    await runToDone(alice);
    const job = await submitJob(alice, { workflowId: "fixture-nsfw", values: {} });
    await waitForStatus(alice, job.id, "done");
    const nsfw = await alice.get("/api/images?nsfw=true");
    expect(nsfw.body.items).toHaveLength(1);
    expect(nsfw.body.items[0].nsfw).toBe(true);
    expect((await alice.get("/api/images?nsfw=false")).body.items).toHaveLength(1);
  });

  it("exposes the values a result was made with, for reuse", async () => {
    const { imageIds } = await runToDone(alice, { prompt: "reuse me", steps: 12 });
    const image = (await alice.get(`/api/images/${imageIds[0]}`)).body;
    expect(image.workflowId).toBe("fixture-txt2img");
    expect(image.params).toMatchObject({ prompt: "reuse me", steps: 12 });
    expect(image.params.seed).toBeGreaterThanOrEqual(0);
    expect(image.seed).toBe(image.params.seed);
    expect(image.width).toBe(64);
    expect(image.hasThumb).toBe(true);
  });
});

describe("media delivery", () => {
  it("serves the file privately with nosniff, Range support and a real thumbnail", async () => {
    const { imageIds } = await runToDone(alice);
    const id = imageIds[0];
    const file = await alice.get(`/api/images/${id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["cache-control"]).toMatch(/^private/);
    expect(file.headers["accept-ranges"]).toBe("bytes");

    const ranged = await alice.get(`/api/images/${id}/file`).set("Range", "bytes=0-9");
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toMatch(/^bytes 0-9\//);
    expect(ranged.body).toHaveLength(10);

    const thumb = await alice.get(`/api/images/${id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers["content-type"]).toBe("image/webp");

    const download = await alice.get(`/api/images/${id}/file?download=1`);
    expect(download.headers["content-disposition"]).toContain(`${id}.png`);
  });

  it("streams a video with Range and has no thumbnail for it", async () => {
    const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    h.comfy.files.set("clip.mp4", { mime: "video/mp4", bytes });
    h.comfy.runScript = (promptId) => {
      h.comfy.history.set(promptId, {
        status: { status_str: "success", completed: true },
        outputs: { "9": { images: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } },
      });
      return [{ type: "executing", data: { node: null, prompt_id: promptId } }];
    };
    const { imageIds } = await runToDone(alice);
    const id = imageIds[0];
    const meta = (await alice.get(`/api/images/${id}`)).body;
    expect(meta).toMatchObject({ kind: "video", mime: "video/mp4", hasThumb: false, width: null });
    const ranged = await alice.get(`/api/images/${id}/file`).set("Range", "bytes=2-5");
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-type"]).toBe("video/mp4");
    expect(ranged.headers["content-range"]).toBe(`bytes 2-5/${bytes.length}`);
    expect((await alice.get(`/api/images/${id}/thumb`)).status).toBe(404);
  });

  it("never lets a request choose a path", async () => {
    await runToDone(alice);
    for (const evil of ["..%2F..%2Fpackage.json", "%2Fetc%2Fpasswd", "....//....//x"]) {
      expect((await alice.get(`/api/images/${evil}/file`)).status).toBe(404);
    }
    expect((await alice.get("/api/images/x/file?path=/etc/passwd")).status).toBe(404);
  });
});

describe("image updates and deletes", () => {
  it("toggles favourite and nsfw and rejects any other field", async () => {
    const { imageIds } = await runToDone(alice);
    const id = imageIds[0];
    const patched = await alice.patch(`/api/images/${id}`).send({ favourite: true, nsfw: true });
    expect(patched.body).toMatchObject({ favourite: true, nsfw: true });
    expect((await alice.patch(`/api/images/${id}`).send({ fileKey: "../x" })).status).toBe(400);
    expect((await alice.patch(`/api/images/${id}`).send({ favourite: "yes" })).status).toBe(400);
  });

  it("deletes the row and both files, and a second delete is a plain 404", async () => {
    const { imageIds } = await runToDone(alice);
    expect(mediaFiles("media")).toHaveLength(1);
    expect(mediaFiles("thumbs")).toHaveLength(1);
    expect((await alice.delete(`/api/images/${imageIds[0]}`)).status).toBe(204);
    expect(mediaFiles("media")).toHaveLength(0);
    expect(mediaFiles("thumbs")).toHaveLength(0);
    expect((await alice.delete(`/api/images/${imageIds[0]}`)).status).toBe(404);
  });

  it("survives a missing file when deleting (row first, files idempotent)", async () => {
    const { imageIds } = await runToDone(alice);
    for (const area of ["media", "thumbs"] as const) {
      const root = path.join(h.dataDir, area);
      for (const folder of fs.readdirSync(root))
        fs.rmSync(path.join(root, folder), { recursive: true });
    }
    expect((await alice.get(`/api/images/${imageIds[0]}/file`)).status).toBe(404);
    expect((await alice.delete(`/api/images/${imageIds[0]}`)).status).toBe(204);
  });
});

describe("follow-up jobs from a stored image", () => {
  it("makes a variation: uploads the stored image, links the lineage and keeps the source", async () => {
    const { imageIds } = await runToDone(alice);
    const source = imageIds[0];
    const res = await alice
      .post(`/api/images/${source}/variation`)
      .send({ workflowId: "fixture-img2img", values: { prompt: "again" } });
    expect(res.body).toMatchObject({ id: expect.any(String) });
    expect(res.status).toBe(202);
    const done = await waitForStatus(alice, res.body.id, "done");
    expect(h.comfy.uploads).toHaveLength(1);
    const submitted = h.comfy.submitted.at(-1) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(submitted.prompt["1"]?.inputs.image).toMatch(/^comfy-[0-9a-f-]+\.png$/);
    const child = (await alice.get(`/api/images/${(done.imageIds as string[])[0]}`)).body;
    expect(child.parentImageId).toBe(source);
    expect(child.params.image).toBe(source);
  });

  it("checks the chosen workflow kind against the action", async () => {
    const { imageIds } = await runToDone(alice);
    const id = imageIds[0];
    const post = (action: string, workflowId: string) =>
      alice.post(`/api/images/${id}/${action}`).send({ workflowId, values: {} });
    expect((await post("variation", "fixture-upscale")).status).toBe(400);
    expect((await post("upscale", "fixture-img2img")).status).toBe(400);
    expect((await post("animate", "fixture-txt2img")).status).toBe(400);
    expect((await post("upscale", "fixture-upscale")).status).toBe(202);
    expect((await post("animate", "fixture-i2v")).status).toBe(202);
  });

  it("refuses a video as a source", async () => {
    h.comfy.files.set("clip.mp4", { mime: "video/mp4", bytes: Buffer.from("video") });
    h.comfy.runScript = (promptId) => {
      h.comfy.history.set(promptId, {
        status: { status_str: "success", completed: true },
        outputs: { "9": { images: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } },
      });
      return [{ type: "executing", data: { node: null, prompt_id: promptId } }];
    };
    const { imageIds } = await runToDone(alice);
    const res = await alice
      .post(`/api/images/${imageIds[0]}/variation`)
      .send({ workflowId: "fixture-img2img", values: {} });
    expect(res.status).toBe(400);
  });
});
