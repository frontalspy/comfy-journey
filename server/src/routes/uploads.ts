import { Router } from "express";
import { BadRequestError, createUploadParser, HttpError } from "../core/kit/index.js";
import { assertUploadRoom, storeUpload } from "../images/uploadService.js";
import { LIMITS } from "../limits.js";
import type { AppServices } from "../services.js";
import { ownerOf } from "./helpers.js";

/**
 * POST /uploads: one reference image (multipart field "image"). The Access identity is required
 * by the gate, and the rate limit and the per-owner cap are checked before the body is read.
 */
export function uploadRoutes(services: AppServices): Router {
  const router = Router();
  const parseUpload = createUploadParser({ maxBytes: LIMITS.maxImageInputBytes });

  router.post("/uploads", async (req, res) => {
    const ownerId = ownerOf(req);
    if (!services.uploadLimiter.tryHit(ownerId)) {
      throw new HttpError(429, "You are uploading too quickly. Try again in a minute.");
    }
    await assertUploadRoom(services.db, ownerId);
    const parsed = await parseUpload(req, res);
    if (!parsed.ok) throw new BadRequestError(parsed.error);
    const image = await storeUpload(
      { db: services.db, store: services.ctx.store, now: services.ctx.now },
      { ownerId, originalName: parsed.file.originalName, buffer: parsed.file.buffer },
    );
    res.status(201).json(image);
  });
  return router;
}
