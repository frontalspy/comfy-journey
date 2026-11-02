import { createHash, randomUUID } from "node:crypto";
import {
  MAX_MEDIA_BYTES,
  type MediaArea,
  type MediaBackend,
  type StoredFileInfo,
} from "./mediaBackend.js";
import { contentTypeForExtension } from "./mime.js";

export type { MediaArea, StoredFileInfo } from "./mediaBackend.js";

const SAFE_EXTENSION = /^[a-z0-9]{1,5}$/;

/** Server-generated names only: `<hash-of-owner>/<uuid>.<ext>`, stored through a MediaBackend. */
export class MediaStore {
  constructor(
    readonly backend: MediaBackend,
    private readonly log: Pick<Console, "warn"> = console,
  ) {}

  /** The folder name for an owner: a hash, so e-mail addresses never appear in a key. */
  ownerFolder(ownerId: string): string {
    return createHash("sha256").update(ownerId.toLowerCase()).digest("hex").slice(0, 24);
  }

  async write(area: MediaArea, ownerId: string, bytes: Uint8Array, ext: string): Promise<string> {
    const contentType = SAFE_EXTENSION.test(ext) ? contentTypeForExtension(ext) : undefined;
    if (!contentType) throw new Error("Unsafe file extension");
    const key = `${this.ownerFolder(ownerId)}/${randomUUID()}.${ext}`;
    await this.backend.put(area, key, bytes, contentType);
    return key;
  }

  read(area: MediaArea, key: string, maxBytes = MAX_MEDIA_BYTES): Promise<Buffer | undefined> {
    return this.backend.read(area, key, maxBytes);
  }

  /** Idempotent, and never throws: a failed delete is logged and left behind. */
  async remove(area: MediaArea, key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.backend.remove(area, key);
    } catch (err) {
      this.log.warn(`[storage] could not remove a ${area} object: ${(err as Error).name}`);
    }
  }

  /** Every stored file, or undefined when the backend cannot enumerate (a remote bucket). */
  async list(): Promise<StoredFileInfo[] | undefined> {
    return this.backend.list?.();
  }

  localPath(area: MediaArea, key: string): string | undefined {
    return this.backend.localPath?.(area, key);
  }

  publicUrl(area: MediaArea, key: string): string | undefined {
    return this.backend.publicUrl?.(area, key);
  }
}
