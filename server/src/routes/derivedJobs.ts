import { createJobRequestSchema } from "@comfy/shared";
import { Router } from "express";
import { NotFoundError, parseBody } from "../core/kit/index.js";
import { getOwnedImage } from "../images/imageRepo.js";
import { type DerivedAction, KINDS_FOR_ACTION } from "../jobs/jobService.js";
import type { AppServices } from "../services.js";
import { ownerOf, paramOf } from "./helpers.js";

/** POST /images/:id/{variation,upscale,animate}: a job whose source is a stored image of the caller. */
export function derivedJobRoutes(services: AppServices): Router {
  const router = Router();
  for (const action of Object.keys(KINDS_FOR_ACTION) as DerivedAction[]) {
    router.post(`/images/:id/${action}`, async (req, res) => {
      const ownerId = ownerOf(req);
      const sourceImageId = paramOf(req, "id");
      // Ownership before body validation, so a foreign id answers 404 whatever the body says.
      const source = await getOwnedImage(services.db, ownerId, sourceImageId);
      if (!source) throw new NotFoundError("Image not found");
      const body = parseBody(createJobRequestSchema, req.body);
      const job = await services.jobs.createJob(ownerId, body, { action, sourceImageId });
      res.status(202).json(job);
    });
  }
  return router;
}
