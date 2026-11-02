import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { QueryBoundary } from "../../components/QueryBoundary";
import { useSystem } from "../activity/hooks/useSystem";
import { Feed } from "./components/Feed";
import { PromptBar } from "./components/PromptBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { splitParams } from "./formValues";
import { useCreateForm } from "./hooks/useCreateForm";

/** Create: the prompt bar pinned on top, the result feed below. */
export function CreateScreen() {
  const form = useCreateForm();
  const system = useSystem();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { workflow } = form;

  return (
    <QueryBoundary isPending={form.isPending} error={form.error}>
      {!workflow ? (
        <EmptyState title="No workflows installed">
          <p>Add a workflow folder to the server and refresh the Workflows page.</p>
        </EmptyState>
      ) : (
        <>
          <PromptBar
            prompt={String(form.values[splitParams(workflow).prompt?.id ?? ""] ?? "")}
            placeholder={`Describe what you want to see…`}
            onPromptChange={(text) =>
              form.setValue(splitParams(workflow).prompt?.id ?? "prompt", text)
            }
            onSubmit={() => void form.submit()}
            onOpenSettings={() => setSettingsOpen(true)}
            blocker={form.blocker}
            submitting={form.submitting}
            summary={summaryLine(form.values, workflow.name)}
          />
          {system.data?.comfyui === "offline" ? (
            <p className="banner banner-bad" role="status">
              ComfyUI is not reachable right now. New creations will wait or fail until it is back.
            </p>
          ) : null}
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            workflows={form.workflows}
            workflow={workflow}
            values={form.values}
            onSelectWorkflow={form.selectWorkflow}
            onChange={form.setValue}
          />
          <Feed />
        </>
      )}
    </QueryBoundary>
  );
}

function summaryLine(values: Record<string, unknown>, workflowName: string): string {
  const { width, height, batch } = values;
  const size =
    typeof width === "number" && typeof height === "number" ? ` · ${width} × ${height}` : "";
  const count = typeof batch === "number" && batch > 1 ? ` · ${batch} images` : "";
  return `${workflowName}${size}${count}`;
}
