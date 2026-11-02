import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeQuietly } from "../test/testApp.js";
import { DiskMediaBackend } from "./diskMediaBackend.js";
import type { MediaBackend } from "./mediaBackend.js";
import { MediaStore } from "./mediaStore.js";
import { S3MediaBackend } from "./s3MediaBackend.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeQuietly(dir);
});

const KEY = "0123456789abcdef01234567/11111111-2222-3333-4444-555555555555.png";
const BYTES = Buffer.from("png-bytes");

/** An in-memory S3: path-style, rejects any request that is not SigV4-signed with the test key. */
function fakeS3Fetch(): typeof fetch {
  const objects = new Map<string, Uint8Array>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (!(headers.get("authorization") ?? "").startsWith("AWS4-HMAC-SHA256 Credential=TESTKEY/")) {
      return new Response("denied", { status: 403 });
    }
    const key = decodeURIComponent(url.pathname);
    switch (init?.method) {
      case "PUT":
        objects.set(key, new Uint8Array(init.body as Uint8Array));
        return new Response(null, { status: 200 });
      case "DELETE":
        objects.delete(key);
        return new Response(null, { status: 204 });
      case "HEAD":
      case "GET": {
        const body = objects.get(key);
        if (!body) return new Response("missing", { status: 404 });
        const length = { "content-length": String(body.length) };
        return init.method === "HEAD"
          ? new Response(null, { status: 200, headers: length })
          : new Response(body, { status: 200, headers: length });
      }
      default:
        return new Response("bad method", { status: 405 });
    }
  }) as typeof fetch;
}

const backends: [string, () => MediaBackend][] = [
  [
    "s3",
    () =>
      new S3MediaBackend(
        {
          bucket: "media",
          region: "auto",
          endpoint: "https://s3.example.test",
          prefix: "comfy",
          accessKeyId: "TESTKEY",
          secretAccessKey: "secret",
        },
        { fetch: fakeS3Fetch() },
      ),
  ],
  [
    "disk",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-backend-"));
      dirs.push(dir);
      return new DiskMediaBackend(dir);
    },
  ],
];

describe.each(backends)("MediaBackend contract: %s", (_name, make) => {
  it("puts, reads, heads and removes, per area", async () => {
    const backend = make();
    await backend.put("media", KEY, BYTES, "image/png");
    await backend.put("thumbs", KEY, Buffer.from("t"), "image/webp");
    expect(await backend.read("media", KEY)).toEqual(BYTES);
    expect(await backend.read("thumbs", KEY)).toEqual(Buffer.from("t"));
    expect(await backend.head("media", KEY)).toEqual({ size: BYTES.byteLength });
    await backend.remove("media", KEY);
    expect(await backend.read("media", KEY)).toBeUndefined();
    expect(await backend.head("media", KEY)).toBeNull();
    expect(await backend.read("thumbs", KEY)).toBeDefined();
  });

  it("removes idempotently and reads a missing object as undefined", async () => {
    const backend = make();
    await backend.remove("media", KEY);
    await backend.remove("media", KEY);
    expect(await backend.read("thumbs", KEY)).toBeUndefined();
  });

  it("rejects keys that could leave their area", async () => {
    const backend = make();
    for (const bad of [
      "../x.png",
      "abc/../../x.png",
      "abc/def/ghi.png",
      "/abs/x.png",
      "abc\\x.png",
      "abc/x.png/",
      "abc/x",
      "abc/x.p/ng",
    ]) {
      await expect(backend.put("media", bad, BYTES, "image/png")).rejects.toThrow();
      await expect(backend.read("media", bad)).rejects.toThrow();
      await expect(backend.remove("media", bad)).rejects.toThrow();
    }
  });
});

describe.each(backends)("MediaStore over %s", (_name, make) => {
  it("writes owner-scoped uuid keys, never trusting the extension", async () => {
    const store = new MediaStore(make(), { warn: () => undefined });
    const key = await store.write("media", "Alice@Example.com", BYTES, "png");
    expect(key).toMatch(/^[0-9a-f]{24}\/[0-9a-f-]{36}\.png$/);
    expect(key).not.toContain("alice");
    expect(key.split("/")[0]).toBe(store.ownerFolder("alice@example.com"));
    for (const ext of ["exe", "../png", "png/x", "", "p n g", "html"]) {
      await expect(store.write("media", "a@b.c", BYTES, ext)).rejects.toThrow("Unsafe");
    }
  });

  it("never throws from remove, even when the backend does", async () => {
    const backend = make();
    backend.remove = async () => {
      throw new Error("down");
    };
    const warnings: string[] = [];
    const store = new MediaStore(backend, { warn: (line: string) => void warnings.push(line) });
    await expect(store.remove("media", KEY)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("S3MediaBackend addressing", () => {
  const base = {
    bucket: "media",
    region: "eu-west-1",
    prefix: "comfy/",
    accessKeyId: "K",
    secretAccessKey: "S",
  };

  it("signs links for the bucket host on AWS, under the prefix, without a bucket path", () => {
    const url = new URL(new S3MediaBackend(base).publicUrl("media", KEY));
    expect(url.host).toBe("media.s3.eu-west-1.amazonaws.com");
    expect(url.pathname).toBe(`/comfy/media/${KEY}`);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
  });

  it("uses path-style addressing for a custom endpoint", () => {
    const url = new URL(
      new S3MediaBackend({ ...base, endpoint: "http://127.0.0.1:9000" }).publicUrl("thumbs", KEY),
    );
    expect(url.origin).toBe("http://127.0.0.1:9000");
    expect(url.pathname).toBe(`/media/comfy/thumbs/${KEY}`);
  });

  it("refuses keys that are not exactly owner/name.ext", async () => {
    const backend = new S3MediaBackend(base, { fetch: fakeS3Fetch() });
    await expect(backend.read("media", "../x.png")).rejects.toThrow();
  });
});
