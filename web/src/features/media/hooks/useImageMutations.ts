import type { AppImage } from "@comfy/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { comfyApi } from "../../../api/comfyApi";
import { useToast } from "../../../components/Toasts";
import { editCachedImage } from "../imageCache";

interface ImageMutations {
  setFavourite: (image: AppImage, favourite: boolean) => Promise<void>;
  remove: (image: AppImage) => Promise<void>;
}

/** Optimistic favourite and delete: the gallery changes at once and rolls back on failure. */
export function useImageMutations(): ImageMutations {
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const setFavourite = useCallback(
    async (image: AppImage, favourite: boolean) => {
      editCachedImage(queryClient, image.id, (current) => ({ ...current, favourite }));
      try {
        await comfyApi.updateImage(image.id, { favourite });
      } catch (error) {
        editCachedImage(queryClient, image.id, (current) => ({
          ...current,
          favourite: image.favourite,
        }));
        notify(error instanceof Error ? error.message : "Could not update.", "error");
      }
    },
    [queryClient, notify],
  );

  const remove = useCallback(
    async (image: AppImage) => {
      editCachedImage(queryClient, image.id, () => null);
      try {
        await comfyApi.deleteImage(image.id);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not delete.", "error");
        await queryClient.invalidateQueries({ queryKey: ["images"] });
      }
    },
    [queryClient, notify],
  );

  return useMemo(() => ({ setFavourite, remove }), [setFavourite, remove]);
}
