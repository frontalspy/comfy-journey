import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asUser, type UserClient } from "./asUser.js";
import { ALICE, BOB, createHarness, type Harness } from "./harness.js";
import { uploadPng } from "./uploadHelpers.js";

let h: Harness;
let alice: UserClient;
let bob: UserClient;
beforeEach(async () => {
  h = await createHarness({ start: false });
  alice = asUser(h, ALICE);
  bob = asUser(h, BOB);
});
afterEach(async () => {
  await h.close();
});

const post = (client: UserClient, body: string) =>
  client.post("/api/jobs").set("Content-Type", "application/json").send(body);

describe("hostile job values", () => {
  it("rejects prototype-pollution style keys and keeps Object.prototype clean", async () => {
    for (const key of ["__proto__", "constructor", "prototype", "toString"]) {
      const res = await post(
        alice,
        `{"workflowId":"fixture-txt2img","values":{"${key}":{"polluted":true}}}`,
      );
      // __proto__ may be dropped by the record parser (harmless); the rest are unknown ids.
      expect(res.status, key).toBe(key === "__proto__" ? 202 : 400);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const stored = await h.services.handle.client.execute("select params from jobs");
    for (const row of stored.rows) expect(String(row.params)).not.toContain("polluted");
  });

  it("refuses oversize, non-string and unknown-parameter image lists", async () => {
    const mine = await uploadPng(alice);
    const refs = (value: unknown) =>
      alice.post("/api/jobs").send({ workflowId: "fixture-refs", values: { refs: value } });
    expect([400, 413]).toContain((await refs(Array(10_000).fill(mine.id))).status);
    expect((await refs([mine.id, mine.id, mine.id, mine.id])).status).toBe(400);
    expect((await refs([{ file: "../../etc/passwd" }])).status).toBe(400);
    expect((await refs([123])).status).toBe(400);
    expect((await refs({ length: 1, 0: mine.id })).status).toBe(400);
    const stray = await alice
      .post("/api/jobs")
      .send({ workflowId: "fixture-txt2img", values: { image: mine.id } });
    expect(stray.status).toBe(400);
  });

  it("ignores a foreign id in the body of a derived job: the source id wins", async () => {
    const theirs = await uploadPng(bob, "theirs.png");
    const mine = await uploadPng(alice, "mine.png");
    const res = await alice
      .post(`/api/images/${mine.id}/variation`)
      .send({ workflowId: "fixture-img2img", values: { image: theirs.id } });
    expect(res.status).toBe(202);
    const row = await h.services.handle.client.execute({
      sql: "select params, source_image_id from jobs where id = ?",
      args: [res.body.id],
    });
    expect(JSON.parse(String(row.rows[0]?.params)).image).toBe(mine.id);
    expect(row.rows[0]?.source_image_id).toBe(mine.id);
    const foreign = await alice
      .post(`/api/images/${theirs.id}/variation`)
      .send({ workflowId: "fixture-img2img", values: {} });
    expect(foreign.status).toBe(404);
  });
});

describe("hostile uploads", () => {
  const attach = (client: UserClient, data: Buffer, name: string, type: string) =>
    client.post("/api/uploads").attach("image", data, { filename: name, contentType: type });

  it("refuses empty files, svg and path-like names without writing anything", async () => {
    expect((await attach(alice, Buffer.alloc(0), "empty.png", "image/png")).status).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>');
    expect([400, 415]).toContain((await attach(alice, svg, "a.svg", "image/svg+xml")).status);
    const png = await (await import("./harness.js")).makePng();
    const polyglot = Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]);
    const ok = await attach(alice, polyglot, "..\\..\\evil/../x.png", "text/html");
    expect(ok.status).toBe(201);
    expect(ok.body.promptSummary).toBe("x.png");
    const stored = await h.services.handle.client.execute("select file_key, mime from images");
    for (const row of stored.rows) {
      expect(String(row.file_key)).not.toContain("..");
      expect(row.mime).toBe("image/png");
    }
  });

  it("keeps uploads out of search, favourites and cursors of the default gallery", async () => {
    const up = await uploadPng(alice, "needle.png");
    await alice.patch(`/api/images/${up.id}`).send({ favourite: true });
    for (const q of ["search=needle", "favourite=true", "kind=image", "limit=1", "nsfw=false"]) {
      const res = await alice.get(`/api/images?${q}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
    expect((await alice.get("/api/images?source=upload&search=needle")).body.items).toHaveLength(1);
    expect((await bob.get("/api/images?source=upload")).body.items).toEqual([]);
  });
});
