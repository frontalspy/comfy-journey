import type { Job } from "@comfy/shared";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";

export const JOBS_KEY = ["jobs"] as const;

/** The caller's recent jobs. Kept live by useJobEvents; never polled. */
export function useJobs(): UseQueryResult<Job[]> {
  return useQuery({ queryKey: JOBS_KEY, queryFn: () => comfyApi.jobs(), staleTime: 60_000 });
}
