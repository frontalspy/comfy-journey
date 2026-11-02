export type MediaKind = "image" | "video";

const KNOWN: Readonly<Record<string, { ext: string; kind: MediaKind }>> = {
  "image/png": { ext: "png", kind: "image" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "video/x-matroska": { ext: "mkv", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
};

const BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

/** Only these output types are kept; anything else from ComfyUI is dropped, never served. */
export function describeMime(mime: string): { ext: string; kind: MediaKind } | undefined {
  return KNOWN[mime.split(";")[0]?.trim().toLowerCase() ?? ""];
}

/**
 * What a ComfyUI output file is, judged by its name (the header /view sends is not trusted to
 * be specific): gif/png/jpg/webp are images, mp4/webm/mkv/mov are videos, anything else
 * (audio, text, ...) is undefined and ignored.
 */
export function describeFilename(
  filename: string,
): { mime: string; ext: string; kind: MediaKind } | undefined {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = BY_EXTENSION[ext];
  const described = mime ? describeMime(mime) : undefined;
  return mime && described ? { mime, ...described } : undefined;
}

/** The Content-Type stored with an object, from the server-side extension map only. */
export function contentTypeForExtension(ext: string): string | undefined {
  return BY_EXTENSION[ext.toLowerCase()];
}
