import type { AppImage } from "@comfy/shared";
import type { ImageActions } from "../../media/hooks/useImageActions";
import { MediaTile } from "../../media/MediaTile";
import { expectedCount, expectedRatio, type FeedGroup, isActive } from "../feedModel";
import { FailedTile } from "./FailedTile";
import { PendingTile, statusLabel } from "./PendingTile";

interface FeedRowProps {
  group: FeedGroup;
  workflowName: string | undefined;
  actions: ImageActions;
  onOpen: (images: readonly AppImage[], image: AppImage) => void;
  onRetry: (group: FeedGroup) => void;
  onDismiss: (jobId: string) => void;
  /** The first row loads its images eagerly; the rest lazily. */
  first: boolean;
}

function gridCount(total: number): string {
  return total > 4 ? "many" : String(total);
}

export function FeedRow({
  group,
  workflowName,
  actions,
  onOpen,
  onRetry,
  onDismiss,
  first,
}: FeedRowProps) {
  const { job, meta, images } = group;
  const active = job ? isActive(job) : false;
  const failed = job?.status === "failed" || job?.status === "cancelled";
  const ratio = expectedRatio(meta);
  const pendingSlots = active ? Math.max(0, expectedCount(meta) - images.length) : 0;
  const tileCount = images.length + pendingSlots + (failed && images.length === 0 ? 1 : 0);
  const prompt = meta?.prompt || images[0]?.promptSummary || "";
  const first4 = images[0];

  return (
    <li className="job-row">
      <div className="job-head">
        <p className="job-prompt">{prompt || workflowName || "Untitled"}</p>
        <div className="chips">
          {workflowName ? <span className="chip">{workflowName}</span> : null}
          {first4?.width && first4.height ? (
            <span className="chip">
              {first4.width}×{first4.height}
            </span>
          ) : null}
        </div>
      </div>
      {job && active ? (
        <p className="sr-only" role="status">
          {statusLabel(job.status)}
        </p>
      ) : null}
      <ul className="tile-grid" data-count={gridCount(Math.max(1, tileCount))}>
        {images.map((image, index) => (
          <MediaTile
            key={image.id}
            image={image}
            actions={actions}
            eager={first && index < 4}
            onOpen={(opened) => onOpen(images, opened)}
          />
        ))}
        {job && active
          ? Array.from({ length: pendingSlots }, (_, slot) => (
              // The slots are interchangeable placeholders, so their position is their identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no other identity.
              <PendingTile key={`pending-${slot}`} job={job} ratio={ratio} />
            ))
          : null}
        {job && failed && images.length === 0 ? (
          <FailedTile
            message={job.error ?? "Generation failed."}
            ratio={ratio}
            cancelled={job.status === "cancelled"}
            onRetry={meta ? () => onRetry(group) : undefined}
            onDismiss={() => onDismiss(job.id)}
          />
        ) : null}
      </ul>
    </li>
  );
}
