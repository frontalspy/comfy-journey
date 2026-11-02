import type { SystemStatus } from "@comfy/shared";
import { Router } from "express";
import { countWaitingJobs } from "../jobs/jobRepo.js";
import type { AppServices } from "../services.js";

export function systemRoutes(services: AppServices): Router {
  const router = Router();
  let probe: { at: number; up: boolean } | undefined;

  const comfyUp = async (): Promise<boolean> => {
    const at = services.ctx.now().getTime();
    if (probe && at - probe.at < services.systemCacheMs) return probe.up;
    const up = await services.ctx.comfy.systemStats().then(
      () => true,
      () => false,
    );
    probe = { at, up };
    return up;
  };

  router.get("/system", async (_req, res) => {
    const [up, queueLength, gpuQueue] = await Promise.all([
      comfyUp(),
      countWaitingJobs(services.db),
      services.ctx.gate.status(),
    ]);
    // Apps and positions only: who and what stay private.
    const body: SystemStatus = {
      comfyui: up ? "up" : "offline",
      queueLength,
      gpuQueue: gpuQueue.map(({ app, position }) => ({ app, position })),
    };
    res.json(body);
  });
  return router;
}
