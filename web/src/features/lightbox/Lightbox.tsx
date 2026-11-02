import type { AppImage } from "@comfy/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { comfyApi } from "../../api/comfyApi";
import { Icon } from "../../components/Icon";
import { ModalDialog } from "../../components/ModalDialog";
import { useImageActions } from "../media/hooks/useImageActions";
import { LightboxPanel } from "./LightboxPanel";

interface LightboxProps {
  images: AppImage[];
  startIndex: number;
  onClose: () => void;
}

const SWIPE_PX = 50;

export default function Lightbox({ images, startIndex, onClose }: LightboxProps) {
  const [items, setItems] = useState(images);
  const [index, setIndex] = useState(startIndex);
  const actions = useImageActions();
  const swipeStart = useRef<number | null>(null);
  const current = items[index];

  const step = useCallback(
    (delta: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + delta))),
    [items.length],
  );

  // Warm the neighbours so stepping through feels instant.
  useEffect(() => {
    for (const neighbour of [items[index - 1], items[index + 1]]) {
      if (neighbour?.kind === "image") new Image().src = comfyApi.fileUrl(neighbour.id);
    }
  }, [items, index]);

  useEffect(() => {
    if (!current) onClose();
  }, [current, onClose]);
  if (!current) return null;

  const closeThen = (action: (image: AppImage) => void) => (image: AppImage) => {
    onClose();
    action(image);
  };

  return (
    <ModalDialog open onClose={onClose} label="Viewer" className="lightbox">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys and swipes are shortcuts; the buttons below are the accessible controls. */}
      <div
        className="lightbox-stage"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          if (event.key === "ArrowRight") step(1);
        }}
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          const from = swipeStart.current;
          swipeStart.current = null;
          if (from === null) return;
          const delta = event.clientX - from;
          if (Math.abs(delta) > SWIPE_PX) step(delta > 0 ? -1 : 1);
        }}
      >
        <button
          type="button"
          className="icon-btn lightbox-close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
        {current.kind === "video" ? (
          // biome-ignore lint/a11y/useMediaCaption: generated clips have no audio track to caption.
          <video
            key={current.id}
            src={comfyApi.fileUrl(current.id)}
            controls
            autoPlay
            loop
            playsInline
          />
        ) : (
          <img key={current.id} src={comfyApi.fileUrl(current.id)} alt={current.promptSummary} />
        )}
        {index > 0 ? (
          <button
            type="button"
            className="icon-btn lightbox-nav prev"
            aria-label="Previous"
            onClick={() => step(-1)}
          >
            <Icon name="prev" />
          </button>
        ) : null}
        {index < items.length - 1 ? (
          <button
            type="button"
            className="icon-btn lightbox-nav next"
            aria-label="Next"
            onClick={() => step(1)}
          >
            <Icon name="next" />
          </button>
        ) : null}
      </div>
      <LightboxPanel
        image={current}
        position={`${index + 1} of ${items.length}`}
        actions={{
          ...actions,
          reusePrompt: closeThen(actions.reusePrompt),
          reuseSettings: closeThen(actions.reuseSettings),
          variation: closeThen(actions.variation),
          toggleFavourite: (image) => {
            actions.toggleFavourite(image);
            setItems((all) =>
              all.map((item) =>
                item.id === image.id ? { ...item, favourite: !item.favourite } : item,
              ),
            );
          },
          remove: (image) => {
            actions.remove(image);
            setItems((all) => all.filter((item) => item.id !== image.id));
            setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
          },
        }}
      />
    </ModalDialog>
  );
}
