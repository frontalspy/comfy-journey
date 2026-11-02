import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { QueryBoundary } from "../../components/QueryBoundary";
import { isActive } from "../create/feedModel";
import { useCancelJob } from "../jobs/hooks/useJobMutations";
import { useJobs } from "../jobs/hooks/useJobs";
import { readJobMeta } from "../jobs/jobMeta";
import { formatDate } from "../media/format";
import { useWorkflows } from "../workflows/hooks/useWorkflows";
import { JobStatusBadge } from "./JobStatus";
import { SystemSummary } from "./SystemSummary";

/** Live progress for everything queued or running, plus recent history. */
export function ActivityScreen() {
  const jobs = useJobs();
  const workflows = useWorkflows().data;
  const cancel = useCancelJob();
  const meta = readJobMeta();

  return (
    <>
      <SystemSummary />
      <QueryBoundary
        isPending={jobs.isPending}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
      >
        {jobs.data?.length ? (
          <ul className="list" aria-label="Jobs">
            {jobs.data.map((job) => {
              const workflowName =
                workflows?.find((w) => w.id === job.workflowId)?.name ?? job.workflowId;
              const cancellable = job.status === "queued" || job.status === "waiting_for_gpu";
              return (
                <li key={job.id} className="list-item">
                  <div className="grow">
                    <p>{meta[job.id]?.prompt || workflowName}</p>
                    <p className="muted" style={{ fontSize: 13 }}>
                      {workflowName} · {formatDate(job.createdAt)}
                      {job.error ? ` · ${job.error}` : ""}
                    </p>
                    {isActive(job) ? (
                      <div
                        className="bar"
                        role="progressbar"
                        aria-label="Progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((job.progress ?? 0) * 100)}
                        style={{ marginTop: 8 }}
                      >
                        <span style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <JobStatusBadge status={job.status} />
                  {cancellable ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Cancel job"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(job.id)}
                    >
                      <Icon name="stop" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No activity yet">
            <p>Jobs you start will show up here with live progress.</p>
          </EmptyState>
        )}
      </QueryBoundary>
    </>
  );
}
