import type { CSSProperties } from "react";
import { Icon } from "../../../components/Icon";

interface FailedTileProps {
  message: string;
  ratio: number;
  cancelled: boolean;
  onRetry: (() => void) | undefined;
  onDismiss: () => void;
}

export function FailedTile({ message, ratio, cancelled, onRetry, onDismiss }: FailedTileProps) {
  return (
    <li className="tile tile-failed" style={{ "--ratio": ratio } as CSSProperties}>
      <p role="alert" style={{ fontSize: 13.5 }}>
        {cancelled ? "Cancelled" : message}
      </p>
      <div className="row">
        {onRetry ? (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            <Icon name="refresh" size={16} /> Retry
          </button>
        ) : null}
        <button type="button" className="btn btn-small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </li>
  );
}
