import { createJobRequestSchema, jobStatusSchema } from "@comfy/shared";
import { Router } from "express";
import { z } from "zod";
import { parseBody, validateBody } from "../core/kit/index.js";
import type { AppServices } from "../services.js";
import { ownerOf, paramOf } from "./helpers.js";

const listQuerySchema = z.object({
  status: jobStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function jobRoutes(services: AppServices): Router {
  const router = Router();
  const { jobs } = services;

  router.post("/jobs", validateBody(createJobRequestSchema), async (req, res) => {
    const job = await jobs.createJob(ownerOf(req), req.body);
    res.status(202).json(job);
  });

  router.get("/jobs", async (req, res) => {
    const query = parseBody(listQuerySchema, req.query);
    res.json(await jobs.listJobs(ownerOf(req), query.status, query.limit));
  });

  router.get("/jobs/:id", async (req, res) => {
    res.json(await jobs.getJob(ownerOf(req), paramOf(req, "id")));
  });

  router.post("/jobs/:id/cancel", async (req, res) => {
    res.json(await jobs.cancelJob(ownerOf(req), paramOf(req, "id")));
  });
  return router;
}
