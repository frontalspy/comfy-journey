import fs from "node:fs/promises";
import path from "node:path";
import { assertNotRealDataInTests } from "../core/kit/index.js";
import {
  assertMediaKey,
  MAX_MEDIA_BYTES,
  type MediaArea,
  type MediaBackend,
  MediaStorageError,
  type StoredFileInfo,
} from "./mediaBackend.js";

/** Local files under `<dataDir>/media` and `<dataDir>/thumbs`, served with sendFile (Range works). */
export class DiskMediaBackend implements MediaBackend {
  readonly kind = "disk" as const;
  private readonly roots: Record<MediaArea, string>;

  constructor(dataDir: string) {
    assertNotRealDataInTests("The media directory", dataDir);
    this.roots = { media: path.join(dataDir, "media"), thumbs: path.join(dataDir, "thumbs") };
  }

  localPath(area: MediaArea, key: string): string {
    assertMediaKey(key);
    const root = this.roots[area];
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error("Key escapes the media directory");
    return target;
  }

  async put(area: MediaArea, key: string, bytes: Uint8Array): Promise<void> {
    const target = this.localPath(area, key);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    } catch {
      throw new MediaStorageError();
    }
  }

  async read(
    area: MediaArea,
    key: string,
    maxBytes = MAX_MEDIA_BYTES,
  ): Promise<Buffer | undefined> {
    const target = this.localPath(area, key);
    try {
      const stat = await fs.stat(target);
      if (stat.size > maxBytes) throw new MediaStorageError("Stored media is too large.");
      return await fs.readFile(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async head(area: MediaArea, key: string): Promise<{ size: number } | null> {
    try {
      return { size: (await fs.stat(this.localPath(area, key))).size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async remove(area: MediaArea, key: string): Promise<void> {
    await fs.rm(this.localPath(area, key), { force: true });
  }

  async list(): Promise<StoredFileInfo[]> {
    const found: StoredFileInfo[] = [];
    for (const area of ["media", "thumbs"] as const) {
      const root = this.roots[area];
      for (const folder of await readDirOrEmpty(root)) {
        for (const name of await readDirOrEmpty(path.join(root, folder))) {
          const stat = await fs.stat(path.join(root, folder, name)).catch(() => undefined);
          if (stat?.isFile()) {
            found.push({ key: `${folder}/${name}`, area, modifiedMs: stat.mtimeMs });
          }
        }
      }
    }
    return found;
  }
}

async function readDirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
