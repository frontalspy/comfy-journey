import { type AppSettings, updateSettingsRequestSchema } from "@comfy/shared";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { validateBody } from "../core/kit/index.js";
import { userSettings } from "../db/schema.js";
import type { AppServices } from "../services.js";
import { ownerOf } from "./helpers.js";

export function settingsRoutes(services: AppServices): Router {
  const router = Router();
  const { db } = services;

  const read = async (ownerId: string): Promise<AppSettings> => {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.ownerId, ownerId))
      .limit(1);
    return { nsfwVisible: row?.nsfwVisible ?? false };
  };

  router.get("/settings", async (req, res) => {
    res.json(await read(ownerOf(req)));
  });

  router.put("/settings", validateBody(updateSettingsRequestSchema), async (req, res) => {
    const ownerId = ownerOf(req);
    const { nsfwVisible } = req.body as AppSettings;
    await db
      .insert(userSettings)
      .values({ ownerId, nsfwVisible })
      .onConflictDoUpdate({ target: userSettings.ownerId, set: { nsfwVisible } });
    res.json(await read(ownerId));
  });
  return router;
}
