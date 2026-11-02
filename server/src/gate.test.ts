import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, TEST_SECRET, TEST_USER } from "./test/testApp.js";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const ROUTES: [string, string][] = [
  ["get", "/api/viewer"],
  ["get", "/api/system"],
  ["get", "/api/workflows"],
  ["post", "/api/workflows/refresh"],
  ["post", "/api/jobs"],
  ["post", "/api/uploads"],
  ["get", "/api/jobs"],
  ["get", "/api/jobs/x"],
  ["get", "/api/jobs/x/events"],
  ["post", "/api/jobs/x/cancel"],
  ["get", "/api/images"],
  ["get", "/api/images/x"],
  ["patch", "/api/images/x"],
  ["delete", "/api/images/x"],
  ["get", "/api/images/x/file"],
  ["get", "/api/images/x/thumb"],
  ["post", "/api/images/x/variation"],
  ["post", "/api/images/x/upscale"],
  ["post", "/api/images/x/animate"],
  ["get", "/api/settings"],
  ["put", "/api/settings"],
];

describe("the auth gate (token mode)", () => {
  it("answers 401 for /api/health and any other /api path without credentials", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    for (const url of ["/api/health", "/api/jobs", "/api/images/x/file", "/api/nothing/here"]) {
      const res = await request(test.app).get(url);
      expect(res.status, url).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("answers 401 on every route and method without credentials", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    for (const [method, url] of ROUTES) {
      const res = await (
        request(test.app) as unknown as Record<string, (u: string) => request.Test>
      )[method]?.(url);
      expect(res?.status, `${method} ${url}`).toBe(401);
      expect(res?.body).toEqual({ error: "Authentication required" });
    }
  });

  it("is a 401 before the body is parsed, even for a malformed body", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    const res = await request(test.app)
      .post("/api/jobs")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(401);
  });

  it("does not tell a wrong secret from a missing one", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    const missing = await request(test.app).get("/api/viewer");
    const wrong = await request(test.app).get("/api/viewer").set("Authorization", "Bearer nope");
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
  });

  it("serves the viewer and the health route with the right bearer secret", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    const auth = { Authorization: `Bearer ${TEST_SECRET}` };
    const viewer = await request(test.app).get("/api/viewer").set(auth);
    expect(viewer.status).toBe(200);
    expect(viewer.body).toEqual({ id: TEST_USER });
    const health = await request(test.app).get("/api/health").set(auth);
    expect(health.status).toBe(200);
  });

  it("answers an unmatched /api path with the JSON 404 once authenticated", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    const res = await request(test.app)
      .get("/api/nothing/here")
      .set("Authorization", `Bearer ${TEST_SECRET}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("signs in with the secret, keeps the session in an HttpOnly cookie, and signs out", async () => {
    const test = await createTestApp();
    cleanup = test.cleanup;
    const bad = await request(test.app).post("/api/auth/login").send({ token: "nope" });
    expect(bad.status).toBe(401);
    const login = await request(test.app).post("/api/auth/login").send({ token: TEST_SECRET });
    expect(login.status).toBe(204);
    const cookie = login.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const viewer = await request(test.app).get("/api/viewer").set("Cookie", cookie);
    expect(viewer.body).toEqual({ id: TEST_USER });
    const out = await request(test.app).post("/api/auth/logout");
    expect(out.status).toBe(204);
    expect(out.headers["set-cookie"]?.[0]).toContain("comfy_session=;");
  });
});

describe("the auth gate (proxy-header mode)", () => {
  const settings = { mode: "proxy-header" as const, trustedProxies: ["127.0.0.1", "::1"] };

  it("takes the user from the header when the peer is a trusted proxy", async () => {
    const test = await createTestApp({}, settings);
    cleanup = test.cleanup;
    const res = await request(test.app).get("/api/viewer").set("X-Forwarded-User", "bob");
    expect(res.body).toEqual({ id: "bob" });
    expect((await request(test.app).get("/api/viewer")).status).toBe(401);
  });

  it("ignores the header from a peer that is not a trusted proxy", async () => {
    const test = await createTestApp({}, { ...settings, trustedProxies: ["10.9.9.9"] });
    cleanup = test.cleanup;
    const res = await request(test.app).get("/api/viewer").set("X-Forwarded-User", "mallory");
    expect(res.status).toBe(401);
  });
});

describe("the auth gate (none mode)", () => {
  it("treats everyone as the one local user on a loopback address", async () => {
    const test = await createTestApp({}, { mode: "none" });
    cleanup = test.cleanup;
    const res = await request(test.app).get("/api/viewer");
    expect(res.body).toEqual({ id: "local" });
  });

  it("refuses to start on a network address unless told it is already protected", async () => {
    await expect(createTestApp({}, { mode: "none", host: "0.0.0.0" })).rejects.toThrow("loopback");
    const allowed = await createTestApp(
      {},
      { mode: "none", host: "0.0.0.0", allowNoAuthOnNetwork: true },
    );
    allowed.cleanup();
  });
});

describe("auth configuration", () => {
  it("refuses token mode without secrets, and weak or duplicate ones", async () => {
    await expect(createTestApp({}, { mode: "token", tokens: undefined })).rejects.toThrow(
      "AUTH_TOKENS",
    );
    await expect(createTestApp({}, { mode: "token", tokens: "a=short" })).rejects.toThrow("16+");
    await expect(
      createTestApp({}, { mode: "token", tokens: "a=0123456789abcdef,a=fedcba9876543210" }),
    ).rejects.toThrow("repeats");
  });

  it("refuses module mode without a module", async () => {
    await expect(createTestApp({}, { mode: "module" })).rejects.toThrow("AUTH_MODULE");
  });
});
