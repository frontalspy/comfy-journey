import sharp from "sharp";

export const THUMB_SIZE = 384;
/** Decoder guard: refuse absurd inputs rather than allocate for them. */
const MAX_INPUT_PIXELS = 100_000_000;

export interface ImageFacts {
  width: number | null;
  height: number | null;
  thumbnail: Buffer | null;
}

/**
 * Dimensions and a webp thumbnail for a generated image. Anything sharp cannot decode (an mp4)
 * yields nulls and the original is still stored as produced.
 */
export async function describeImage(bytes: Uint8Array): Promise<ImageFacts> {
  try {
    const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false });
    const meta = await source.metadata();
    const thumbnail = await source
      .rotate()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { width: meta.width ?? null, height: meta.height ?? null, thumbnail };
  } catch {
    return { width: null, height: null, thumbnail: null };
  }
}
