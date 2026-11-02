import type { AppImage } from "@comfy/shared";
import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { aspectRatio } from "../../media/format";
import type { ImageActions } from "../../media/hooks/useImageActions";
import { MediaTile } from "../../media/MediaTile";
import { columnsForWidth, distribute } from "../masonry";

interface LibraryGridProps {
  images: readonly AppImage[];
  actions: ImageActions;
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  onOpen: (image: AppImage) => void;
}

/** A masonry grid whose column count follows its own width. */
export function LibraryGrid({ images, actions, selecting, selectedIds, onOpen }: LibraryGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(2);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setColumns(columnsForWidth(element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lanes = useMemo(
    () => distribute(images, columns, (image) => aspectRatio(image.width, image.height)),
    [images, columns],
  );

  return (
    <div ref={ref} className="masonry" style={{ "--cols": columns } as CSSProperties}>
      {lanes.map((lane, laneIndex) => (
        // The lane number is its identity: lanes are positional.
        // biome-ignore lint/suspicious/noArrayIndexKey: lanes are positional columns.
        <ul key={laneIndex} className="masonry-col" aria-label={`Column ${laneIndex + 1}`}>
          {lane.map((image) => (
            <MediaTile
              key={image.id}
              image={image}
              actions={actions}
              selecting={selecting}
              selected={selectedIds.has(image.id)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ))}
    </div>
  );
}
