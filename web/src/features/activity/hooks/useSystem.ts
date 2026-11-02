import type { SystemStatus } from "@comfy/shared";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";

/** Cheap server health, re-read every 15 seconds while the tab is visible. */
export function useSystem(): UseQueryResult<SystemStatus> {
  return useQuery({
    queryKey: ["system"],
    queryFn: comfyApi.system,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}
