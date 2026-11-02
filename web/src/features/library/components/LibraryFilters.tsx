import type { PublicWorkflow } from "@comfy/shared";
import { Icon } from "../../../components/Icon";

export interface LibraryFilterState {
  search: string;
  kind: "all" | "image" | "video";
  favourite: boolean;
  workflowId: string;
}

interface LibraryFiltersProps {
  filters: LibraryFilterState;
  workflows: PublicWorkflow[];
  selecting: boolean;
  onChange: (next: LibraryFilterState) => void;
  onToggleSelecting: () => void;
}

const KINDS: { value: LibraryFilterState["kind"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

export function LibraryFilters({
  filters,
  workflows,
  selecting,
  onChange,
  onToggleSelecting,
}: LibraryFiltersProps) {
  return (
    <search className="filters">
      <label className="sr-only" htmlFor="library-search">
        Search prompts
      </label>
      <input
        id="library-search"
        className="input"
        type="search"
        placeholder="Search prompts"
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
      />
      <fieldset className="seg" aria-label="Type">
        {KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            aria-pressed={filters.kind === kind.value}
            onClick={() => onChange({ ...filters, kind: kind.value })}
          >
            {kind.label}
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        className="chip"
        aria-pressed={filters.favourite}
        onClick={() => onChange({ ...filters, favourite: !filters.favourite })}
      >
        <Icon name="heart" size={16} filled={filters.favourite} /> Favourites
      </button>
      {workflows.length > 1 ? (
        <>
          <label className="sr-only" htmlFor="library-workflow">
            Workflow
          </label>
          <select
            id="library-workflow"
            className="select"
            value={filters.workflowId}
            onChange={(event) => onChange({ ...filters, workflowId: event.target.value })}
          >
            <option value="">All workflows</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <button type="button" className="chip" aria-pressed={selecting} onClick={onToggleSelecting}>
        <Icon name="check" size={16} /> Select
      </button>
    </search>
  );
}
