import { randomUUID } from "node:crypto";
import type { AppImage } from "@comfy/shared";
import sharp from "sharp";
import { BadRequestError, HttpError } from "../core/kit/index.js";
import type { AppDatabase } from "../db/client.js";
import { MediaStorageError } from "../storage/mediaBackend.js";
import type { MediaStore } from "../storage/mediaStore.js";
import { describeImage } from "../storage/thumbnails.js";
import { countOwnedUploads, getOwnedImage, insertImage, toImageDto } from "./imageRepo.js";
import { UPLOAD_LIMITS } from "./uploadLimits.js";

const ACCEPTED = {
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
} as const;

/** The label an upload shows: the file's own name, never a path, with control characters gone. */
export function sanitiseUploadName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, UPLOAD_LIMITS.maxNameLength) || "upload";
}

export interface NormalisedUpload {
  bytes: Buffer;
  ext: string;
  mime: string;
  width: number;
  height: number;
}

/**
 * Decodes the bytes (the declared type and file name are never trusted), accepts only png, jpeg
 * and webp, applies the EXIF orientation, drops all metadata and re-encodes in the same format.
 */
export async function normaliseUpload(bytes: Buffer): Promise<NormalisedUpload> {
  const options = { limitInputPixels: UPLOAD_LIMITS.maxPixels, animated: false } as const;
  let format: string | undefined;
  try {
    format = (await sharp(bytes, options).metadata()).format;
  } catch {
    throw new BadRequestError("That file is not a readable image.");
  }
  const accepted = format ? ACCEPTED[format as keyof typeof ACCEPTED] : undefined;
  if (!accepted) throw new HttpError(415, "Only PNG, JPEG and WebP images can be uploaded.");
  try {
    // Orientation is baked in by rotate(); sharp writes no EXIF/ICC/XMP unless asked to.
    const pipeline = sharp(bytes, options).rotate().toColourspace("srgb");
    const encoded =
      accepted.ext === "png"
        ? pipeline.png({ compressionLevel: 9 })
        : accepted.ext === "jpg"
          ? pipeline.jpeg({ quality: 92 })
          : pipeline.webp({ quality: 92 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      ext: accepted.ext,
      mime: accepted.mime,
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new BadRequestError("That file is not a readable image.");
  }
}

export interface UploadInput {
  ownerId: string;
  originalName: string;
  buffer: Buffer;
}

export interface UploadDeps {
  db: AppDatabase;
  store: MediaStore;
  now(): Date;
}

/** Refuses when the owner already holds the maximum number of uploads. */
export async function assertUploadRoom(db: AppDatabase, ownerId: string): Promise<void> {
  if ((await countOwnedUploads(db, ownerId)) >= UPLOAD_LIMITS.maxUploadsPerOwner) {
    throw new HttpError(429, "You have reached the upload limit. Delete some uploads to add more.");
  }
}

/** Validates, normalises, stores (file + thumbnail) and records one upload. */
export async function storeUpload(deps: UploadDeps, input: UploadInput): Promise<AppImage> {
  const { db, store, now } = deps;
  const normalised = await normaliseUpload(input.buffer);
  const facts = await describeImage(normalised.bytes);
  const written: { media: string | null; thumb: string | null } = { media: null, thumb: null };
  const id = randomUUID();
  try {
    written.media = await store.write("media", input.ownerId, normalised.bytes, normalised.ext);
    if (facts.thumbnail) {
      written.thumb = await store.write("thumbs", input.ownerId, facts.thumbnail, "webp");
    }
    await insertImage(db, {
      id,
      jobId: null,
      ownerId: input.ownerId,
      kind: "image",
      source: "upload",
      fileKey: written.media,
      thumbKey: written.thumb,
      width: normalised.width,
      height: normalised.height,
      mime: normalised.mime,
      bytes: normalised.bytes.byteLength,
      promptSummary: sanitiseUploadName(input.originalName),
      createdAt: now().toISOString(),
    });
  } catch (err) {
    await store.remove("media", written.media);
    await store.remove("thumbs", written.thumb);
    if (err instanceof MediaStorageError) {
      throw new HttpError(502, "The upload could not be saved. Try again later.");
    }
    throw err;
  }
  const record = await getOwnedImage(db, input.ownerId, id);
  if (!record) throw new Error("Upload vanished after insert");
  return toImageDto(record);
}
