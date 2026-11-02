import { ConfirmButton } from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";

interface BulkBarProps {
  count: number;
  onFavourite: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkBar({ count, onFavourite, onDelete, onClear }: BulkBarProps) {
  return (
    <section className="bulk-bar" aria-label="Selection">
      <span aria-live="polite">{count} selected</span>
      <button type="button" className="btn btn-small" onClick={onFavourite} disabled={count === 0}>
        <Icon name="heart" size={16} /> Favourite
      </button>
      {count > 0 ? (
        <ConfirmButton
          className="btn btn-small btn-danger"
          label={`Delete ${count} items`}
          onConfirm={onDelete}
        >
          <Icon name="trash" size={16} /> Delete
        </ConfirmButton>
      ) : null}
      <button type="button" className="btn btn-small" onClick={onClear}>
        Done
      </button>
    </section>
  );
}
