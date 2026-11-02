export type MediaArea = "media" | "thumbs";

export interface StoredFileInfo {
  key: string;
  area: MediaArea;
  modifiedMs: number;
}

/** Largest single object this service will buffer for a put or a proxied read (videos included). */
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024;

/**
 * Where media bytes live. Keys are the row keys (`<owner-hash>/<uuid>.<ext>`) and are identical
 * on every backend: a backend adds its own prefix (a directory, or a key prefix in a bucket),
 * which is never stored in a row. That is what lets a disk-to-bucket migration leave the database alone.
 */
export interface MediaBackend {
  readonly kind: "disk" | "s3";
  /** Writes (overwrites) one object. Throws MediaStorageError when the backend cannot. */
  put(area: MediaArea, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes, or undefined when the object does not exist. Throws past `maxBytes`. */
  read(area: MediaArea, key: string, maxBytes?: number): Promise<Buffer | undefined>;
  /** Size of the object, or null when it does not exist. */
  head(area: MediaArea, key: string): Promise<{ size: number } | null>;
  /** Idempotent: a missing object is fine. */
  remove(area: MediaArea, key: string): Promise<void>;
  /** Every stored object; only the disk backend can enumerate (the orphan sweep needs it). */
  list?(): Promise<StoredFileInfo[]>;
  /** Absolute path of an object (disk only), so the route can answer Range requests. */
  localPath?(area: MediaArea, key: string): string;
  /** The object's public URL (remote only: a presigned URL). Pure: no existence check, no network. */
  publicUrl?(area: MediaArea, key: string): string;
}

/** A backend failure. The message is safe to show; the cause stays in the server log. */
export class MediaStorageError extends Error {
  constructor(message = "Media storage failed.") {
    super(message);
    this.name = "MediaStorageError";
  }
}

const KEY_PATTERN = /^[a-z0-9]{1,64}\/[A-Za-z0-9-]{1,64}\.[a-z0-9]{1,5}$/;

/** Rejects anything that is not exactly `<owner-hash>/<name>.<ext>`: no `..`, no extra segments. */
export function assertMediaKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error("Key escapes the media directory");
}
