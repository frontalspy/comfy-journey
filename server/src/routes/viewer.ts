import type { Viewer } from "@comfy/shared";
import { Router } from "express";
import { ownerOf } from "./helpers.js";

export function viewerRoutes(): Router {
  const router = Router();
  router.get("/viewer", (req, res) => {
    const viewer: Viewer = { id: ownerOf(req) };
    res.json(viewer);
  });
  return router;
}
