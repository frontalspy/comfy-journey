import { z } from "zod";

/**
 * A reference image after the worker uploaded it to ComfyUI. `file` is "<subfolder>/<filename>" as
 * ComfyUI addresses it; `name` is the original display name; dimensions are null when unknown.
 */
export interface ResolvedImage {
  file: string;
  name: string;
  width: number | null;
  height: number | null;
}

export const resolvedImageSchema = z
  .object({
    file: z.string().min(1).max(300),
    name: z.string().min(1).max(300),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  })
  .strict();

const UID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function freshUid(random: () => number): string {
  let uid = "mm";
  for (let i = 0; i < 8; i += 1) uid += UID_ALPHABET[Math.floor(random() * UID_ALPHABET.length)];
  return uid;
}

/** The JSON string the MiniMax H3 media loader keeps in its `media_state` input. */
export function encodeH3MediaState(images: readonly ResolvedImage[], random: () => number): string {
  return JSON.stringify(
    images.map((image) => ({
      kind: "picture",
      file: `${image.file} [input]`,
      name: image.name,
      duration: null,
      width: image.width,
      height: image.height,
      has_audio: false,
      audio_mode: "off",
      uid: freshUid(random),
    })),
  );
}
