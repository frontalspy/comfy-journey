import { Router } from "express";
import type { AppServices } from "../services.js";
import { derivedJobRoutes } from "./derivedJobs.js";
import { imageFileRoutes } from "./imageFiles.js";
import { imageRoutes } from "./images.js";
import { jobEventRoutes } from "./jobEvents.js";
import { jobRoutes } from "./jobs.js";
import { settingsRoutes } from "./settings.js";
import { systemRoutes } from "./system.js";
import { uploadRoutes } from "./uploads.js";
import { viewerRoutes } from "./viewer.js";
import { workflowRoutes } from "./workflows.js";

/** Every route. Mounted under /api, which is already behind the auth gate. */
export function apiRoutes(services: AppServices): Router {
  const router = Router();
  router.use(viewerRoutes());
  router.use(systemRoutes(services));
  router.use(workflowRoutes(services));
  router.use(jobRoutes(services));
  router.use(jobEventRoutes(services));
  router.use(uploadRoutes(services));
  router.use(imageRoutes(services));
  router.use(imageFileRoutes(services));
  router.use(derivedJobRoutes(services));
  router.use(settingsRoutes(services));
  return router;
}
