import type { AppImage } from "@comfy/shared";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../../components/Toasts";
import { mergeValues, promptText, splitParams, valuesForSubmit } from "../../create/formValues";
import { useCreateFormState } from "../../create/hooks/CreateFormProvider";
import { useCreateJob } from "../../jobs/hooks/useJobMutations";
import { useWorkflows } from "../../workflows/hooks/useWorkflows";
import { useImageMutations } from "./useImageMutations";

export interface ImageActions {
  toggleFavourite: (image: AppImage) => void;
  remove: (image: AppImage) => void;
  reusePrompt: (image: AppImage) => void;
  reuseSettings: (image: AppImage) => void;
  /** Same settings, new seed, started straight away. */
  variation: (image: AppImage) => void;
}

/** Everything a person can do with a result, shared by the feed, library and lightbox. */
export function useImageActions(): ImageActions {
  const navigate = useNavigate();
  const { notify } = useToast();
  const mutations = useImageMutations();
  const form = useCreateFormState();
  const workflows = useWorkflows().data;
  const createJob = useCreateJob();

  const reuseSettings = useCallback(
    (image: AppImage) => {
      const workflow = workflows?.find((candidate) => candidate.id === image.workflowId);
      if (!workflow) return notify("That workflow is no longer installed.", "error");
      const values = mergeValues(workflow, image.params);
      if (image.seed !== null && "seed" in values) values.seed = image.seed;
      form.replaceValues(workflow.id, values);
      navigate("/");
    },
    [workflows, form, navigate, notify],
  );

  const reusePrompt = useCallback(
    (image: AppImage) => {
      const workflow = workflows?.find((candidate) => candidate.id === image.workflowId);
      const promptId = workflow ? splitParams(workflow).prompt?.id : undefined;
      if (!workflow || !promptId) return notify("That workflow is no longer installed.", "error");
      form.selectWorkflow(workflow.id);
      form.setValue(
        workflow.id,
        promptId,
        promptText(workflow, mergeValues(workflow, image.params)),
      );
      navigate("/");
    },
    [workflows, form, navigate, notify],
  );

  const variation = useCallback(
    (image: AppImage) => {
      const workflow = workflows?.find((candidate) => candidate.id === image.workflowId);
      if (!workflow?.available) return notify("That workflow is not available right now.", "error");
      const values = mergeValues(workflow, image.params);
      if ("seed" in values) values.seed = -1;
      createJob.mutate({
        request: { workflowId: workflow.id, values: valuesForSubmit(workflow, values) },
        prompt: promptText(workflow, values),
      });
      navigate("/");
    },
    [workflows, createJob, navigate, notify],
  );

  return useMemo(
    () => ({
      toggleFavourite: (image) => void mutations.setFavourite(image, !image.favourite),
      remove: (image) => void mutations.remove(image),
      reusePrompt,
      reuseSettings,
      variation,
    }),
    [mutations, reusePrompt, reuseSettings, variation],
  );
}
