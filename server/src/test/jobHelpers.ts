import type { UserClient } from "./asUser.js";
import { until } from "./harness.js";

export type JobBody = { workflowId: string; values: Record<string, unknown> };

export const TXT2IMG: JobBody = { workflowId: "fixture-txt2img", values: {} };

export async function submitJob(
  client: UserClient,
  body: JobBody = TXT2IMG,
): Promise<{ id: string; status: string }> {
  const res = await client.post("/api/jobs").send(body);
  if (res.status !== 202) throw new Error(`POST /api/jobs answered ${res.status}`);
  return res.body;
}

export async function waitForStatus(
  client: UserClient,
  jobId: string,
  status: string,
): Promise<Record<string, unknown>> {
  return until(async () => {
    const res = await client.get(`/api/jobs/${jobId}`);
    return res.body.status === status ? res.body : undefined;
  });
}

/** Submits a txt2img job with the given values and waits for it to finish. */
export async function runToDone(
  client: UserClient,
  values: Record<string, unknown> = {},
): Promise<{ id: string; imageIds: string[] }> {
  const { id } = await submitJob(client, { ...TXT2IMG, values });
  const done = await waitForStatus(client, id, "done");
  return { id, imageIds: done.imageIds as string[] };
}
