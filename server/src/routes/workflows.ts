import { Router } from "express";
import { NotFoundError } from "../core/kit/index.js";
import type { AppServices } from "../services.js";
import { paramOf } from "./helpers.js";

export function workflowRoutes(services: AppServices): Router {
  const router = Router();
  const { registry } = services.ctx;

  router.get("/workflows", (_req, res) => {
    res.json(registry.list());
  });

  router.get("/workflows/:id/preview", (req, res, next) => {
    const file = registry.previewPath(paramOf(req, "id"));
    if (!file) throw new NotFoundError("Preview not found");
    res.sendFile(
      file,
      {
        dotfiles: "allow",
        headers: { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
      },
      (err) => {
        if (err && !res.headersSent) next(new NotFoundError("Preview not found"));
      },
    );
  });

  router.post("/workflows/refresh", async (_req, res) => {
    await registry.refresh();
    res.json(registry.list());
  });
  return router;
}
