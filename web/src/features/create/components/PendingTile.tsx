import type { Job } from "@comfy/shared";
import type { CSSProperties } from "react";
import { ProgressRing } from "./ProgressRing";

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "In line",
  waiting_for_gpu: "Waiting for the GPU",
  running: "Creating",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const statusLabel = (status: Job["status"]): string => STATUS_LABEL[status];

interface PendingTileProps {
  job: Job;
  ratio: number;
}

/** A placeholder with a progress ring that fills in once the result arrives. */
export function PendingTile({ job, ratio }: PendingTileProps) {
  return (
    <li className="tile tile-pending" style={{ "--ratio": ratio } as CSSProperties}>
      <div style={{ textAlign: "center" }}>
        <ProgressRing progress={job.status === "running" ? (job.progress ?? 0) : null} />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          {statusLabel(job.status)}
        </p>
      </div>
    </li>
  );
}
