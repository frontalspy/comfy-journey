import type { AppImage } from "@comfy/shared";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// The viewer and its panel load on first use, keeping them out of the first screen's bundle.
const Lightbox = lazy(() => import("./Lightbox"));

interface OpenState {
  images: AppImage[];
  index: number;
}

interface LightboxApi {
  openLightbox: (images: readonly AppImage[], image: AppImage) => void;
}

const LightboxContext = createContext<LightboxApi | null>(null);

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenState | null>(null);

  const openLightbox = useCallback((images: readonly AppImage[], image: AppImage) => {
    const index = images.findIndex((candidate) => candidate.id === image.id);
    setOpen({ images: [...images], index: Math.max(0, index) });
  }, []);
  const close = useCallback(() => setOpen(null), []);
  const api = useMemo<LightboxApi>(() => ({ openLightbox }), [openLightbox]);

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {open ? (
        <Suspense fallback={null}>
          <Lightbox images={open.images} startIndex={open.index} onClose={close} />
        </Suspense>
      ) : null}
    </LightboxContext.Provider>
  );
}

export function useLightbox(): LightboxApi {
  const api = useContext(LightboxContext);
  if (!api) throw new Error("useLightbox must be used inside LightboxProvider");
  return api;
}
