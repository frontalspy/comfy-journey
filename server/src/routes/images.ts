import { imageListQuerySchema, updateImageRequestSchema } from "@comfy/shared";
import { Router } from "express";
import { NotFoundError, parseBody } from "../core/kit/index.js";
import {
  getOwnedImage,
  listOwnedImages,
  toImageDto,
  updateOwnedImage,
} from "../images/imageRepo.js";
import { deleteOwnedImage } from "../images/imageService.js";
import type { AppServices } from "../services.js";
import { ownerOf, paramOf } from "./helpers.js";

export function imageRoutes(services: AppServices): Router {
  const router = Router();
  const { db, ctx } = services;

  router.get("/images", async (req, res) => {
    const query = parseBody(imageListQuerySchema, req.query);
    res.json(await listOwnedImages(db, ownerOf(req), query));
  });

  router.get("/images/:id", async (req, res) => {
    const record = await getOwnedImage(db, ownerOf(req), paramOf(req, "id"));
    if (!record) throw new NotFoundError("Image not found");
    res.json(toImageDto(record));
  });

  router.patch("/images/:id", async (req, res) => {
    const ownerId = ownerOf(req);
    const id = paramOf(req, "id");
    // Existence first: a 404 must win over a 400 so a foreign id never reveals itself.
    if (!(await getOwnedImage(db, ownerId, id))) throw new NotFoundError("Image not found");
    const patch = parseBody(updateImageRequestSchema, req.body);
    await updateOwnedImage(db, ownerId, id, patch);
    const record = await getOwnedImage(db, ownerId, id);
    if (!record) throw new NotFoundError("Image not found");
    res.json(toImageDto(record));
  });

  router.delete("/images/:id", async (req, res) => {
    const removed = await deleteOwnedImage(db, ctx.store, ownerOf(req), paramOf(req, "id"));
    if (!removed) throw new NotFoundError("Image not found");
    res.status(204).end();
  });
  return router;
}
