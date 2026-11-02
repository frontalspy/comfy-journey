import type { AppImage } from "@comfy/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { ImagesData } from "./hooks/useImages";

type Edit = (image: AppImage) => AppImage | null;

/** Applies an edit to one image in every cached gallery; returning null removes it. */
export function editCachedImage(queryClient: QueryClient, imageId: string, edit: Edit): void {
  queryClient.setQueriesData<ImagesData>({ queryKey: ["images"] }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.flatMap((image) => {
          if (image.id !== imageId) return [image];
          const next = edit(image);
          return next ? [next] : [];
        }),
      })),
    };
  });
}
