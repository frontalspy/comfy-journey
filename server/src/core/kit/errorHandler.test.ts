import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorHandler } from "./errorHandler.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
} from "./errors.js";

function appThrowing(error: unknown) {
  const log = vi.fn();
  const app = express();
  app.use(express.json());
  app.get("/sync", () => {
    throw error;
  });
  app.get("/async", async () => {
    throw error;
  });
  app.get("/items/:id", (req, res) => {
    res.json({ id: req.params.id });
  });
  app.post("/echo", (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler({ log }));
  return { app, log };
}

describe("HttpError subclasses", () => {
  it.each([
    [new BadRequestError(), 400, "Bad request"],
    [new UnauthorizedError(), 401, "Unauthorized"],
    [new ForbiddenError(), 403, "Forbidden"],
    [new NotFoundError(), 404, "Not found"],
    [new ConflictError(), 409, "Conflict"],
  ])("%s carries its status and default message", (error, status, message) => {
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it("drops an empty issues list", () => {
    expect(new BadRequestError("x", []).issues).toBeUndefined();
  });
});

describe("errorHandler", () => {
  it("sends an HttpError's status and message, from sync and async handlers alike", async () => {
    const { app } = appThrowing(new NotFoundError("Character not found"));
    for (const route of ["/sync", "/async"]) {
      const res = await request(app).get(route);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Character not found" });
    }
  });

  it("includes issues when the error has them", async () => {
    const { app } = appThrowing(new BadRequestError("name: Required", ["name: Required"]));
    const res = await request(app).get("/sync");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "name: Required", issues: ["name: Required"] });
  });

  it("turns a thrown ZodError into a 400 with every issue", async () => {
    const result = z.object({ a: z.string(), b: z.number() }).safeParse({});
    if (result.success) throw new Error("expected failure");
    const { app } = appThrowing(result.error);
    const res = await request(app).get("/async");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("a: Required");
    expect(res.body.issues).toEqual(["a: Required", "b: Required"]);
  });

  it("answers unknown errors with a generic 500 and logs them server-side", async () => {
    const { app, log } = appThrowing(new Error("SQLITE_CONSTRAINT: secret internals"));
    const res = await request(app).get("/async");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("SQLITE");
    expect(log).toHaveBeenCalledOnce();
  });

  it("maps malformed JSON to a 400 in the shared shape", async () => {
    const { app, log } = appThrowing(new Error("unused"));
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Malformed JSON body." });
    expect(log).not.toHaveBeenCalled();
  });

  it("answers a malformed URI param with a generic 400, not a logged 500", async () => {
    const { app, log } = appThrowing(new Error("unused"));
    const res = await request(app).get("/items/%E0%A4%A");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad Request" });
    expect(JSON.stringify(res.body)).not.toContain("decode");
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the status of any exposed 4xx error but never echoes its message", async () => {
    const error = Object.assign(new Error("secret client detail"), {
      statusCode: 415,
      expose: true,
    });
    const { app, log } = appThrowing(error);
    const res = await request(app).get("/sync");
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: "Unsupported Media Type" });
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["a 4xx explicitly not exposed", { status: 400, expose: false }],
    ["a 5xx status", { status: 500, expose: true }],
    ["a non-4xx status", { status: 302 }],
    ["an exposed 5xx", { status: 503, expose: true }],
  ])("still answers %s as a generic logged 500", async (_label, props) => {
    const { app, log } = appThrowing(Object.assign(new Error("internals"), props));
    const res = await request(app).get("/sync");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(log).toHaveBeenCalledOnce();
  });
});
