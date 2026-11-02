import request from "supertest";
import { describe, expect, it } from "vitest";
import { NotFoundError, UnauthorizedError } from "./errors.js";
import { createHttpApp, type HttpAppOptions } from "./httpApp.js";

function buildApp(options: Partial<HttpAppOptions> = {}) {
  return createHttpApp({
    healthPath: "/api/health",
    mount(app) {
      app.post("/api/echo", (req, res) => {
        res.json(req.body);
      });
      app.get("/api/missing", () => {
        throw new NotFoundError("Thing not found");
      });
    },
    ...options,
  });
}

describe("createHttpApp", () => {
  it("serves the health route", async () => {
    const res = await request(buildApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("parses JSON bodies and enforces the configured limit", async () => {
    const app = buildApp({ jsonLimit: "1kb" });
    expect((await request(app).post("/api/echo").send({ a: 1 })).body).toEqual({ a: 1 });
    const tooBig = await request(app)
      .post("/api/echo")
      .send({ blob: "x".repeat(2048) });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ error: "Request body too large." });
  });

  it("installs the error handler after the mounted routes", async () => {
    const res = await request(buildApp()).get("/api/missing");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Thing not found" });
  });

  it("allows only the configured origins, with credentials", async () => {
    const app = buildApp({ cors: { origins: "https://a.example, https://b.example" } });
    const allowed = await request(app).get("/api/health").set("Origin", "https://b.example");
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://b.example");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    const denied = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reflects any origin only when asked to and no list is configured", async () => {
    const reflecting = buildApp({ cors: { reflectAnyOrigin: true } });
    const res = await request(reflecting).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const none = await request(buildApp()).get("/api/health").set("Origin", "http://x.example");
    expect(none.headers["access-control-allow-origin"]).toBeUndefined();
  });

  describe("gate", () => {
    function gatedApp() {
      return buildApp({
        jsonLimit: "1kb",
        cors: { origins: "https://a.example" },
        gate(app) {
          app.use("/api", (req, _res, next) => {
            if (req.header("x-ok") === "1") next();
            else next(new UnauthorizedError("Authentication required"));
          });
        },
      });
    }

    it("runs before body parsing, so bad bodies from unauthenticated callers get 401", async () => {
      const app = gatedApp();
      const malformed = await request(app)
        .post("/api/echo")
        .set("Content-Type", "application/json")
        .send("{not json");
      expect(malformed.status).toBe(401);
      const tooBig = await request(app)
        .post("/api/echo")
        .send({ blob: "x".repeat(2048) });
      expect(tooBig.status).toBe(401);
    });

    it("lets authorised callers through to body parsing and its errors", async () => {
      const app = gatedApp();
      const malformed = await request(app)
        .post("/api/echo")
        .set("x-ok", "1")
        .set("Content-Type", "application/json")
        .send("{not json");
      expect(malformed.status).toBe(400);
      const tooBig = await request(app)
        .post("/api/echo")
        .set("x-ok", "1")
        .send({ blob: "x".repeat(2048) });
      expect(tooBig.status).toBe(413);
      expect((await request(app).post("/api/echo").set("x-ok", "1").send({ a: 1 })).body).toEqual({
        a: 1,
      });
    });

    it("puts health behind the gate and answers CORS preflight without consulting it", async () => {
      const app = gatedApp();
      expect((await request(app).get("/api/health")).status).toBe(401);
      expect((await request(app).get("/api/health").set("x-ok", "1")).status).toBe(200);
      const preflight = await request(app)
        .options("/api/echo")
        .set("Origin", "https://a.example")
        .set("Access-Control-Request-Method", "POST");
      expect(preflight.status).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe("https://a.example");
    });
  });
});
