import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createUploadParser } from "./uploads.js";

const parseUpload = createUploadParser({ maxBytes: 16 });

const app = express();
app.post("/upload", async (req, res) => {
  const result = await parseUpload(req, res);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ text: result.file.buffer.toString("utf8"), size: result.file.size });
});

describe("createUploadParser", () => {
  it("buffers the single file in memory", async () => {
    const res = await request(app).post("/upload").attach("image", Buffer.from("tiny"), "a.png");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "tiny", size: 4 });
  });

  it("rejects a file over the size limit", async () => {
    const res = await request(app).post("/upload").attach("image", Buffer.alloc(64), "big.png");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Upload too large or malformed." });
  });

  it("rejects a request with no file in the expected field", async () => {
    const res = await request(app).post("/upload").field("note", "no file");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No image file provided." });
  });
});
