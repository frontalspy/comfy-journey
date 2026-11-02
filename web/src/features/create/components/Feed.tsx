import { useMemo } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { useLoadMoreSentinel } from "../../../hooks/useLoadMoreSentinel";
import { useCreateJob } from "../../jobs/hooks/useJobMutations";
import { useJobs } from "../../jobs/hooks/useJobs";
import { readJobMeta } from "../../jobs/jobMeta";
import { useLightbox } from "../../lightbox/LightboxProvider";
import { useImageActions } from "../../media/hooks/useImageActions";
import { useImages } from "../../media/hooks/useImages";
import { useWorkflows } from "../../workflows/hooks/useWorkflows";
import { buildFeed, type FeedGroup } from "../feedModel";
import { useDismissedJobs } from "../hooks/useDismissedJobs";
import { FeedRow } from "./FeedRow";

/** The newest-first result feed under the prompt bar. */
export function Feed() {
  const jobs = useJobs();
  const gallery = useImages({});
  const workflows = useWorkflows().data;
  const actions = useImageActions();
  const { openLightbox } = useLightbox();
  const createJob = useCreateJob();
  const { dismissed, dismiss } = useDismissedJobs();

  // The remembered requests are re-read whenever the job list changes (a new job stores its own first).
  const groups = useMemo(
    () =>
      buildFeed(jobs.data ?? [], gallery.images, readJobMeta(), Date.now()).filter(
        (group) => !dismissed.has(group.jobId),
      ),
    [jobs.data, gallery.images, dismissed],
  );

  const sentinel = useLoadMoreSentinel(
    () => void gallery.fetchNextPage(),
    Boolean(gallery.hasNextPage) && !gallery.isFetchingNextPage,
  );

  function retry(group: FeedGroup): void {
    if (!group.meta) return;
    createJob.mutate({
      request: { workflowId: group.meta.workflowId, values: group.meta.values },
      prompt: group.meta.prompt,
    });
    dismiss(group.jobId);
  }

  return (
    <QueryBoundary
      isPending={jobs.isPending || gallery.isPending}
      error={jobs.error ?? gallery.error}
      onRetry={() => {
        void jobs.refetch();
        void gallery.refetch();
      }}
    >
      {groups.length === 0 ? (
        <EmptyState title="Nothing here yet">
          <p>Describe something above and press Enter. Your results will collect here.</p>
        </EmptyState>
      ) : (
        <ul className="feed" aria-label="Results">
          {groups.map((group, index) => (
            <FeedRow
              key={group.jobId}
              group={group}
              first={index === 0}
              workflowName={
                workflows?.find(
                  (w) => w.id === (group.job?.workflowId ?? group.images[0]?.workflowId),
                )?.name
              }
              actions={actions}
              onOpen={openLightbox}
              onRetry={retry}
              onDismiss={dismiss}
            />
          ))}
        </ul>
      )}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {gallery.isFetchingNextPage ? (
        <div className="empty" role="status">
          <div className="spinner" />
          <span className="sr-only">Loading more</span>
        </div>
      ) : null}
    </QueryBoundary>
  );
}
