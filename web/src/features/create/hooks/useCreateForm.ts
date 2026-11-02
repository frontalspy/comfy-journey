import type { PublicWorkflow } from "@comfy/shared";
import { useCallback, useMemo } from "react";
import { useCreateJob } from "../../jobs/hooks/useJobMutations";
import { useVisibleWorkflows } from "../../workflows/hooks/useWorkflows";
import {
  type FormValues,
  mergeValues,
  missingRequirement,
  promptText,
  valuesForSubmit,
} from "../formValues";
import { useCreateFormState } from "./CreateFormProvider";

export interface CreateForm {
  workflows: PublicWorkflow[];
  workflow: PublicWorkflow | undefined;
  values: FormValues;
  isPending: boolean;
  error: Error | null;
  blocker: string | undefined;
  submitting: boolean;
  selectWorkflow: (workflowId: string) => void;
  setValue: (paramId: string, value: unknown) => void;
  /** Starts a job with the current values. Resolves true when the server accepted it. */
  submit: () => Promise<boolean>;
}

/** The selected workflow, its validated values and the submit action, in one place. */
export function useCreateForm(): CreateForm {
  const { workflows, isPending, error } = useVisibleWorkflows();
  const state = useCreateFormState();
  const createJob = useCreateJob();

  const workflow = useMemo(() => {
    const usable = workflows.filter((candidate) => candidate.available);
    return (
      usable.find((candidate) => candidate.id === state.workflowId) ?? usable[0] ?? workflows[0]
    );
  }, [workflows, state.workflowId]);

  const remembered = workflow ? state.rememberedValues(workflow.id) : undefined;
  const values = useMemo(
    () => (workflow ? mergeValues(workflow, remembered) : {}),
    [workflow, remembered],
  );

  const setValue = useCallback(
    (paramId: string, value: unknown) => {
      if (workflow) state.setValue(workflow.id, paramId, value);
    },
    [workflow, state],
  );

  const blocker = workflow
    ? workflow.available
      ? missingRequirement(workflow, values)
      : (workflow.unavailableReason ?? "This workflow is not available.")
    : "No workflow is available.";

  const submit = useCallback(async (): Promise<boolean> => {
    if (!workflow || blocker) return false;
    try {
      await createJob.mutateAsync({
        request: { workflowId: workflow.id, values: valuesForSubmit(workflow, values) },
        prompt: promptText(workflow, values),
      });
      return true;
    } catch {
      return false; // useCreateJob already told the user.
    }
  }, [workflow, blocker, values, createJob]);

  return {
    workflows,
    workflow,
    values,
    isPending,
    error,
    blocker,
    submitting: createJob.isPending,
    selectWorkflow: state.selectWorkflow,
    setValue,
    submit,
  };
}
