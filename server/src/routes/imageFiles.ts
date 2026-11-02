import { type Response, Router } from "express";
import { NotFoundError } from "../core/kit/index.js";
import { getOwnedImage } from "../images/imageRepo.js";
import type { AppServices } from "../services.js";
import { MAX_MEDIA_BYTES, type MediaArea } from "../storage/mediaBackend.js";
import { describeMime } from "../storage/mime.js";
import { ownerOf, paramOf } from "./helpers.js";

/** Keys are immutable UUIDs, so an hour of private caching is safe for both delivery paths. */
const CACHE_CONTROL = "private, max-age=3600";

/**
 * Owner-checked media delivery. The key always comes from the image row (a server-generated
 * key), never from the request, and the owner check runs before any URL or byte is revealed.
 * Disk answers with sendFile (which handles Range for video); a remote bucket answers 302 to the object's
 * public URL, where the bucket itself serves Range.
 */
export function imageFileRoutes(services: AppServices): Router {
  const router = Router();
  const { db, ctx } = services;

  router.get("/images/:id/file", async (req, res) => {
    const record = await getOwnedImage(db, ownerOf(req), paramOf(req, "id"));
    if (!record) throw new NotFoundError("Image not found");
    const { row } = record;
    const ext = describeMime(row.mime)?.ext ?? "bin";
    const download = req.query.download === "1" ? `${row.id}.${ext}` : undefined;
    await deliver(ctx.store, res, "media", row.fileKey, row.mime, download);
  });

  router.get("/images/:id/thumb", async (req, res) => {
    const record = await getOwnedImage(db, ownerOf(req), paramOf(req, "id"));
    if (!record?.row.thumbKey) throw new NotFoundError("Thumbnail not found");
    await deliver(ctx.store, res, "thumbs", record.row.thumbKey, "image/webp");
  });
  return router;
}

type Store = AppServices["ctx"]["store"];

async function deliver(
  store: Store,
  res: Response,
  area: MediaArea,
  key: string,
  mime: string,
  downloadName?: string,
): Promise<void> {
  const url = store.publicUrl(area, key);
  if (url && !downloadName) {
    res.set("Cache-Control", CACHE_CONTROL);
    res.redirect(302, url);
    return;
  }
  if (url) {
    // A redirect cannot force a download name, so a download is proxied (capped, in memory).
    const bytes = await store.read(area, key, MAX_MEDIA_BYTES);
    if (!bytes) throw new NotFoundError("File not found");
    if (downloadName) res.attachment(downloadName);
    res.set({
      "Content-Type": mime,
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(bytes);
    return;
  }
  const localPath = store.localPath(area, key);
  if (!localPath) throw new NotFoundError("File not found");
  if (downloadName) res.attachment(downloadName);
  await sendLocal(res, localPath, mime);
}

function sendLocal(res: Response, absolutePath: string, mime: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    res.sendFile(
      absolutePath,
      {
        dotfiles: "allow",
        cacheControl: false,
        headers: {
          "Content-Type": mime,
          "Cache-Control": CACHE_CONTROL,
          "X-Content-Type-Options": "nosniff",
        },
      },
      (err) => {
        if (!err) return resolve();
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new NotFoundError("File not found"));
        }
        // An aborted download after headers went out is not worth an error response.
        if (res.headersSent) return resolve();
        reject(err);
      },
    );
  });
}
