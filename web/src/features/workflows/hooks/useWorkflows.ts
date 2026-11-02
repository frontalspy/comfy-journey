import type { PublicWorkflow } from "@comfy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";
import { useNsfwVisible } from "../../settings/hooks/useSettings";

export const WORKFLOWS_KEY = ["workflows"] as const;

export function useWorkflows() {
  return useQuery({ queryKey: WORKFLOWS_KEY, queryFn: comfyApi.workflows, staleTime: 60_000 });
}

/** The workflows this person may pick, in server order, with NSFW ones hidden unless enabled. */
export function useVisibleWorkflows(): {
  workflows: PublicWorkflow[];
  isPending: boolean;
  error: Error | null;
} {
  const query = useWorkflows();
  const nsfwVisible = useNsfwVisible();
  const workflows = (query.data ?? []).filter((workflow) => nsfwVisible || !workflow.nsfw);
  return { workflows, isPending: query.isPending, error: query.error };
}

export function useRefreshWorkflows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: comfyApi.refreshWorkflows,
    onSuccess: (workflows) => queryClient.setQueryData(WORKFLOWS_KEY, workflows),
  });
}
