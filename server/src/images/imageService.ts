import type { AppDatabase } from "../db/client.js";
import type { MediaStore } from "../storage/mediaStore.js";
import { deleteOwnedImageRow } from "./imageRepo.js";

/** Row first, then files (idempotent), so a crash leaves an orphan file and never a dangling row. */
export async function deleteOwnedImage(
  db: AppDatabase,
  store: MediaStore,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const row = await deleteOwnedImageRow(db, ownerId, id);
  if (!row) return false;
  await store.remove("media", row.fileKey);
  await store.remove("thumbs", row.thumbKey);
  return true;
}
