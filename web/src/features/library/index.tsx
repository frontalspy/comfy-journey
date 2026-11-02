import type { AppImage } from "@comfy/shared";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { QueryBoundary } from "../../components/QueryBoundary";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useLoadMoreSentinel } from "../../hooks/useLoadMoreSentinel";
import { useLightbox } from "../lightbox/LightboxProvider";
import { useImageActions } from "../media/hooks/useImageActions";
import { useImageMutations } from "../media/hooks/useImageMutations";
import { useImages } from "../media/hooks/useImages";
import { useVisibleWorkflows } from "../workflows/hooks/useWorkflows";
import { BulkBar } from "./components/BulkBar";
import { type LibraryFilterState, LibraryFilters } from "./components/LibraryFilters";
import { LibraryGrid } from "./components/LibraryGrid";

const INITIAL_FILTERS: LibraryFilterState = {
  search: "",
  kind: "all",
  favourite: false,
  workflowId: "",
};

/** Everything ever made, searchable, with multi-select for bulk actions. */
export function LibraryScreen() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const search = useDebouncedValue(filters.search.trim(), 300);

  const gallery = useImages({
    search: search || undefined,
    kind: filters.kind === "all" ? undefined : filters.kind,
    favourite: filters.favourite || undefined,
    workflowId: filters.workflowId || undefined,
  });
  const { workflows } = useVisibleWorkflows();
  const actions = useImageActions();
  const mutations = useImageMutations();
  const { openLightbox } = useLightbox();

  const sentinel = useLoadMoreSentinel(
    () => void gallery.fetchNextPage(),
    Boolean(gallery.hasNextPage) && !gallery.isFetchingNextPage,
  );

  function handleOpen(image: AppImage): void {
    if (!selecting) {
      openLightbox(gallery.images, image);
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(image.id)) next.add(image.id);
      return next;
    });
  }

  function stopSelecting(): void {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  const chosen = gallery.images.filter((image) => selectedIds.has(image.id));
  const filtered =
    search !== "" || filters.kind !== "all" || filters.favourite || filters.workflowId !== "";

  return (
    <>
      <LibraryFilters
        filters={filters}
        workflows={workflows}
        selecting={selecting}
        onChange={setFilters}
        onToggleSelecting={() => (selecting ? stopSelecting() : setSelecting(true))}
      />
      <QueryBoundary
        isPending={gallery.isPending}
        error={gallery.error}
        onRetry={() => void gallery.refetch()}
      >
        {gallery.images.length === 0 ? (
          <EmptyState title={filtered ? "No matches" : "Your library is empty"}>
            <p>
              {filtered
                ? "Try a different search or filter."
                : "Everything you create will be saved here."}
            </p>
          </EmptyState>
        ) : (
          <LibraryGrid
            images={gallery.images}
            actions={actions}
            selecting={selecting}
            selectedIds={selectedIds}
            onOpen={handleOpen}
          />
        )}
        <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      </QueryBoundary>
      {selecting ? (
        <BulkBar
          count={chosen.length}
          onClear={stopSelecting}
          onFavourite={() => {
            for (const image of chosen)
              if (!image.favourite) void mutations.setFavourite(image, true);
          }}
          onDelete={() => {
            for (const image of chosen) void mutations.remove(image);
            setSelectedIds(new Set());
          }}
        />
      ) : null}
    </>
  );
}
