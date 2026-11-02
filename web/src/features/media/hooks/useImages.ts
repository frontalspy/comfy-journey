import type { AppImage, ImageListQuery } from "@comfy/shared";
import { type InfiniteData, useInfiniteQuery } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";
import { useNsfwVisible } from "../../settings/hooks/useSettings";

export type ImageFilters = Partial<Pick<ImageListQuery, "kind" | "workflowId" | "search">> & {
  favourite?: boolean;
};

export type ImagesData = InfiniteData<
  { items: AppImage[]; nextCursor: string | null },
  string | undefined
>;

const PAGE_SIZE = 40;

/** Newest-first cursor-paged gallery. The key starts with "images" so one call refreshes them all. */
export function useImages(filters: ImageFilters) {
  const nsfwVisible = useNsfwVisible();
  const query = useInfiniteQuery({
    queryKey: ["images", filters, nsfwVisible],
    queryFn: ({ pageParam }) =>
      comfyApi.images({
        ...filters,
        cursor: pageParam,
        limit: PAGE_SIZE,
        nsfw: nsfwVisible ? undefined : false,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const images = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...query, images };
}
