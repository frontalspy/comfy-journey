import type { AppSettings } from "@comfy/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";

export const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: comfyApi.settings, staleTime: 5 * 60_000 });
}

/** Whether images and workflows marked NSFW may be shown. Hidden until settings have loaded. */
export function useNsfwVisible(): boolean {
  return useSettings().data?.nsfwVisible ?? false;
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: comfyApi.saveSettings,
    onMutate: async (next: AppSettings) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_KEY);
      queryClient.setQueryData(SETTINGS_KEY, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["images"] }),
  });
}
