import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "./errorHandler.js";
import { BadRequestError } from "./errors.js";
import { parseBody, validateBody } from "./validate.js";

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

describe("parseBody", () => {
  it("returns the parsed (transformed) value", () => {
    expect(parseBody(schema, { email: " A@Example.com " })).toEqual({ email: "a@example.com" });
  });

  it("throws a BadRequestError with a readable message and issues", () => {
    expect(() => parseBody(schema, { email: "nope" })).toThrow(BadRequestError);
    try {
      parseBody(schema, { email: "nope" });
    } catch (err) {
      expect((err as BadRequestError).message).toBe("email: Invalid email");
      expect((err as BadRequestError).issues).toEqual(["email: Invalid email"]);
    }
  });

  it("treats a missing body as {} so all-optional schemas still accept it", () => {
    expect(parseBody(z.object({ name: z.string().optional() }), undefined)).toEqual({});
  });
});

describe("validateBody", () => {
  const app = express();
  app.use(express.json());
  app.post("/", validateBody(schema), (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler());

  it("hands the handler the parsed body", async () => {
    const res = await request(app).post("/").send({ email: "B@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "b@example.com" });
  });

  it("rejects with the shared 400 body", async () => {
    const res = await request(app).post("/").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "email: Required", issues: ["email: Required"] });
  });
});
