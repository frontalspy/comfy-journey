import { afterEach, describe, expect, it } from "vitest";
import { asUser } from "../test/asUser.js";
import { ALICE, createHarness, type Harness } from "../test/harness.js";
import { runToDone } from "../test/jobHelpers.js";

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("media delivery on disk", () => {
  it("serves bytes with Range support and private caching", async () => {
    const h = await createHarness();
    harness = h;
    const alice = asUser(h, ALICE);
    const { imageIds } = await runToDone(alice);
    const full = await alice.get(`/api/images/${imageIds[0]}/file`);
    expect(full.status).toBe(200);
    expect(full.headers["cache-control"]).toBe("private, max-age=3600");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    const part = await alice.get(`/api/images/${imageIds[0]}/file`).set("Range", "bytes=0-3");
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toMatch(/^bytes 0-3\//);
  });
});
