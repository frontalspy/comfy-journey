import type { Viewer } from "@comfy/shared";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";

export const VIEWER_KEY = ["viewer"] as const;

export function useViewer(): UseQueryResult<Viewer> {
  return useQuery({
    queryKey: VIEWER_KEY,
    queryFn: comfyApi.viewer,
    retry: false,
    staleTime: Infinity,
  });
}
