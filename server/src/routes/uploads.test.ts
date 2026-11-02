import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertImage } from "../images/imageRepo.js";
import { UPLOAD_LIMITS } from "../images/uploadLimits.js";
import { LIMITS } from "../limits.js";
import { asUser, type UserClient } from "../test/asUser.js";
import { ALICE, BOB, createHarness, type Harness, makePng } from "../test/harness.js";
import { uploadPng } from "../test/uploadHelpers.js";

let h: Harness;
let alice: UserClient;
beforeEach(async () => {
  h = await createHarness({ start: false });
  alice = asUser(h, ALICE);
});
afterEach(async () => {
  await h.close();
});

function storedFiles(area: "media" | "thumbs"): string[] {
  const root = path.join(h.dataDir, area);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap((folder) => fs.readdirSync(path.join(root, folder)));
}

function firstMediaKey(): string {
  const folder = fs.readdirSync(path.join(h.dataDir, "media"))[0] ?? "";
  const name = fs.readdirSync(path.join(h.dataDir, "media", folder))[0] ?? "";
  return `${folder}/${name}`;
}

function attach(bytes: Buffer, filename: string, contentType: string) {
  return alice.post("/api/uploads").attach("image", bytes, { filename, contentType });
}

describe("POST /api/uploads", () => {
  it("stores a png, jpeg and webp and answers the upload with no job", async () => {
    const base = sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } });
    const cases = [
      { name: "a.png", bytes: await base.clone().png().toBuffer(), mime: "image/png" },
      { name: "b.jpg", bytes: await base.clone().jpeg().toBuffer(), mime: "image/jpeg" },
      { name: "c.webp", bytes: await base.clone().webp().toBuffer(), mime: "image/webp" },
    ];
    for (const item of cases) {
      const res = await attach(item.bytes, item.name, item.mime);
      expect(res.status, item.name).toBe(201);
      expect(res.body).toMatchObject({
        jobId: null,
        source: "upload",
        kind: "image",
        mime: item.mime,
        width: 40,
        height: 30,
        promptSummary: item.name,
        hasThumb: true,
      });
      expect((await alice.get(`/api/images/${res.body.id}/file`)).status).toBe(200);
      expect((await alice.get(`/api/images/${res.body.id}/thumb`)).status).toBe(200);
    }
    expect(storedFiles("media")).toHaveLength(3);
    expect(storedFiles("thumbs")).toHaveLength(3);
  });

  it("strips metadata and keeps only the sanitised file name, never a path", async () => {
    const withExif = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#aaa" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "secret-owner" } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const res = await attach(withExif, "C:\\Users\\me\\pics/holiday.jpg", "image/jpeg");
    expect(res.status).toBe(201);
    expect(res.body.promptSummary).toBe("holiday.jpg");
    const stored = fs.readFileSync(path.join(h.dataDir, "media", firstMediaKey()));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes("secret-owner")).toBe(false);
  });

  it("rejects a type that is not png, jpeg or webp, by decoding rather than by header", async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .gif()
      .toBuffer();
    expect((await attach(gif, "a.png", "image/png")).status).toBe(415);
    expect((await attach(Buffer.from("just some text"), "a.txt", "text/plain")).status).toBe(400);
    // A text file wearing an image content type and extension is still not an image.
    expect((await attach(Buffer.from("<svg/>"), "x.png", "image/png")).status).toBe(400);
    // And a real png under a wrong declared type is accepted: the bytes decide.
    expect((await attach(await makePng(), "x.txt", "text/plain")).status).toBe(201);
    expect(storedFiles("media")).toHaveLength(1);
  });

  it("rejects a corrupt or truncated image and writes nothing", async () => {
    const png = await makePng(200, 200);
    expect((await attach(png.subarray(0, 40), "cut.png", "image/png")).status).toBe(400);
    const damaged = Buffer.from(png);
    damaged.fill(0x41, 60, damaged.length - 20);
    expect((await attach(damaged, "bad.png", "image/png")).status).toBe(400);
    expect(storedFiles("media")).toEqual([]);
    expect((await alice.get("/api/images?source=upload")).body.items).toEqual([]);
  });

  it("rejects a missing file and an oversize one", async () => {
    expect((await alice.post("/api/uploads")).status).toBe(400);
    const big = Buffer.alloc(LIMITS.maxImageInputBytes + 1, 1);
    const res = await attach(big, "big.png", "image/png");
    expect(res.status).toBe(400);
    expect(storedFiles("media")).toEqual([]);
  });

  it("caps the decoded pixel count", async () => {
    const side = Math.ceil(Math.sqrt(UPLOAD_LIMITS.maxPixels)) + 1;
    const huge = await sharp({
      create: { width: side, height: side, channels: 3, background: "#000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect((await attach(huge, "huge.png", "image/png")).status).toBe(400);
    expect(storedFiles("media")).toEqual([]);
  });

  it("rate limits uploads per owner", async () => {
    for (let i = 0; i < UPLOAD_LIMITS.rateLimit.hits; i++) h.services.uploadLimiter.tryHit(ALICE);
    const limited = await attach(await makePng(), "a.png", "image/png");
    expect(limited.status).toBe(429);
    expect(storedFiles("media")).toEqual([]);
    expect((await uploadPng(asUser(h, BOB))).id).toEqual(expect.any(String));
  });

  it("caps how many uploads one owner can hold", async () => {
    const first = await uploadPng(alice);
    for (let i = 1; i < UPLOAD_LIMITS.maxUploadsPerOwner; i++) {
      await insertImage(h.services.db, {
        id: `filler-${i}`,
        jobId: null,
        ownerId: ALICE,
        kind: "image",
        source: "upload",
        fileKey: `x/filler-${i}.png`,
        mime: "image/png",
        bytes: 1,
        createdAt: new Date(2020, 0, 1, 0, 0, i % 60).toISOString(),
      });
    }
    const over = await attach(await makePng(), "more.png", "image/png");
    expect(over.status).toBe(429);
    expect((await uploadPng(asUser(h, BOB))).id).toEqual(expect.any(String));
    // Deleting one makes room again.
    expect((await alice.delete(`/api/images/${first.id}`)).status).toBe(204);
    expect((await attach(await makePng(), "again.png", "image/png")).status).toBe(201);
  });

  it("answers 401 without an identity", async () => {
    const res = await request(h.app)
      .post("/api/uploads")
      .attach("image", await makePng(), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });
});

describe("uploads and the gallery", () => {
  it("keeps uploads out of the default gallery and lists them with source=upload", async () => {
    const upload = await uploadPng(alice, "ref.png");
    expect((await alice.get("/api/images")).body.items).toEqual([]);
    expect((await alice.get("/api/images?source=generated")).body.items).toEqual([]);
    expect((await alice.get("/api/images?favourite=false&kind=image")).body.items).toEqual([]);
    const listed = await alice.get("/api/images?source=upload");
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([upload.id]);
    expect(listed.body.items[0]).toMatchObject({ source: "upload", jobId: null });
    expect((await asUser(h, BOB).get("/api/images?source=upload")).body.items).toEqual([]);
  });

  it("patches, deletes (with its files) and answers 404 on a second delete", async () => {
    const upload = await uploadPng(alice);
    const fav = await alice.patch(`/api/images/${upload.id}`).send({ favourite: true });
    expect(fav.body.favourite).toBe(true);
    expect((await alice.delete(`/api/images/${upload.id}`)).status).toBe(204);
    expect(storedFiles("media")).toEqual([]);
    expect(storedFiles("thumbs")).toEqual([]);
    expect((await alice.delete(`/api/images/${upload.id}`)).status).toBe(404);
  });

  it("never sweeps an upload, however old", async () => {
    const upload = await uploadPng(alice);
    const result = await h.services.sweep();
    expect(result.jobsRemoved).toBe(0);
    expect((await alice.get(`/api/images/${upload.id}`)).status).toBe(200);
    expect(storedFiles("media")).toHaveLength(1);
  });
});
