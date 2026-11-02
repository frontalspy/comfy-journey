import type { AppImage } from "@comfy/shared";
import { type CSSProperties, memo } from "react";
import { comfyApi } from "../../api/comfyApi";
import { Icon } from "../../components/Icon";
import { aspectRatio } from "./format";
import type { ImageActions } from "./hooks/useImageActions";
import { VideoPreview } from "./VideoPreview";

interface MediaTileProps {
  image: AppImage;
  actions: ImageActions;
  onOpen: (image: AppImage) => void;
  /** In selection mode a press toggles selection instead of opening. */
  selecting?: boolean;
  selected?: boolean;
  /** Skip the lazy-load hint for the first screenful. */
  eager?: boolean;
}

function MediaTileView({ image, actions, onOpen, selecting, selected, eager }: MediaTileProps) {
  const ratio = aspectRatio(image.width, image.height);
  const label = image.promptSummary || "Generated result";
  const style = { "--ratio": ratio } as CSSProperties;

  return (
    <li
      className="tile"
      style={style}
      data-selected={selecting ? String(Boolean(selected)) : undefined}
    >
      <button
        type="button"
        className="tile-open"
        aria-label={selecting ? `${selected ? "Deselect" : "Select"}: ${label}` : `Open: ${label}`}
        aria-pressed={selecting ? Boolean(selected) : undefined}
        onClick={() => onOpen(image)}
      >
        {image.kind === "video" ? (
          <VideoPreview imageId={image.id} hasThumb={image.hasThumb === true} alt={label} />
        ) : (
          <img
            src={
              image.hasThumb === false ? comfyApi.fileUrl(image.id) : comfyApi.thumbUrl(image.id)
            }
            width={image.width ?? undefined}
            height={image.height ?? undefined}
            alt={label}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
          />
        )}
      </button>
      {selecting ? (
        <span className="tile-check" aria-hidden="true">
          {selected ? <Icon name="check" size={14} /> : null}
        </span>
      ) : (
        <div className="tile-actions" role="toolbar" aria-label="Actions">
          <button
            type="button"
            className="icon-btn"
            aria-pressed={image.favourite}
            aria-label={image.favourite ? "Remove from favourites" : "Add to favourites"}
            onClick={() => actions.toggleFavourite(image)}
          >
            <Icon name="heart" size={18} filled={image.favourite} />
          </button>
          <button
            type="button"
            className="icon-btn secondary"
            aria-label="Reuse prompt"
            onClick={() => actions.reusePrompt(image)}
          >
            <Icon name="text" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="New variation"
            onClick={() => actions.variation(image)}
          >
            <Icon name="refresh" size={18} />
          </button>
          {actions.canUpscale && image.kind === "image" ? (
            <button
              type="button"
              className="icon-btn secondary"
              aria-label="Upscale"
              onClick={() => actions.upscale(image)}
            >
              <Icon name="upscale" size={18} />
            </button>
          ) : null}
          <a
            className="icon-btn secondary"
            aria-label="Download"
            href={comfyApi.downloadUrl(image.id)}
            download
          >
            <Icon name="download" size={18} />
          </a>
        </div>
      )}
    </li>
  );
}

export const MediaTile = memo(MediaTileView);
