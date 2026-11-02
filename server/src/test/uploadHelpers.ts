import type { UserClient } from "./asUser.js";
import { makePng } from "./harness.js";

/** POSTs a real PNG to /api/uploads as `client` and returns the created image (throws otherwise). */
export async function uploadPng(
  client: UserClient,
  name = "reference.png",
  size: [number, number] = [32, 24],
): Promise<{ id: string; [key: string]: unknown }> {
  const res = await client
    .post("/api/uploads")
    .attach("image", await makePng(...size), { filename: name, contentType: "image/png" });
  if (res.status !== 201) throw new Error(`POST /api/uploads answered ${res.status}`);
  return res.body;
}
