import { useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { QueryBoundary } from "../../components/QueryBoundary";
import { useCreateFormState } from "../create/hooks/CreateFormProvider";
import { useRefreshWorkflows, useVisibleWorkflows } from "./hooks/useWorkflows";
import { WorkflowCard } from "./WorkflowCard";

/** What this server can make, and whether each workflow is ready to run. */
export function WorkflowsScreen() {
  const { workflows, isPending, error } = useVisibleWorkflows();
  const refresh = useRefreshWorkflows();
  const form = useCreateFormState();
  const navigate = useNavigate();

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <Icon name="refresh" size={18} /> {refresh.isPending ? "Checking…" : "Re-check workflows"}
        </button>
      </div>
      <QueryBoundary isPending={isPending} error={error}>
        {workflows.length === 0 ? (
          <EmptyState title="No workflows installed">
            <p>
              Put a workflow folder (a ComfyUI API graph and a manifest) in the server&apos;s
              workflows directory.
            </p>
          </EmptyState>
        ) : (
          <ul className="cards" aria-label="Workflows">
            {workflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                selected={form.workflowId === workflow.id}
                onUse={() => {
                  form.selectWorkflow(workflow.id);
                  navigate("/");
                }}
              />
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
