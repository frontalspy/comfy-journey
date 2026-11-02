import { useRef, useState } from "react";
import { comfyApi } from "../../api/comfyApi";
import { useInView } from "../../hooks/useInView";
import { formatDuration } from "./format";

interface VideoPreviewProps {
  imageId: string;
  hasThumb: boolean;
  alt: string;
}

/**
 * A silent loop that only loads once the tile is near the screen and only plays on hover.
 * Touch devices open the lightbox instead, so nothing autoplays on a phone's data plan.
 */
export function VideoPreview({ imageId, hasThumb, alt }: VideoPreviewProps) {
  const { ref, inView } = useInView<HTMLDivElement>("300px");
  const video = useRef<HTMLVideoElement>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  return (
    <div
      ref={ref}
      className="video-preview"
      style={{ width: "100%", height: "100%" }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") void video.current?.play().catch(() => undefined);
      }}
      onPointerLeave={() => {
        video.current?.pause();
        if (video.current) video.current.currentTime = 0;
      }}
    >
      {inView ? (
        <video
          ref={video}
          src={`${comfyApi.fileUrl(imageId)}#t=0.1`}
          poster={hasThumb ? comfyApi.thumbUrl(imageId) : undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={alt}
          onLoadedMetadata={(event) => setSeconds(event.currentTarget.duration)}
        />
      ) : null}
      {seconds ? <span className="tile-badge">{formatDuration(seconds)}</span> : null}
    </div>
  );
}
