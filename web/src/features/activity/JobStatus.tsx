import type { Job } from "@comfy/shared";
import { statusLabel } from "../create/components/PendingTile";

const TONE: Partial<Record<Job["status"], string>> = {
  done: "badge-ok",
  failed: "badge-bad",
  cancelled: "badge-bad",
};

/** A status badge. The text carries the meaning; colour only reinforces it. */
export function JobStatusBadge({ status }: { status: Job["status"] }) {
  return <span className={`badge ${TONE[status] ?? ""}`}>{statusLabel(status)}</span>;
}
