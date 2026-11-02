import type { AppImage, PublicWorkflow } from "@comfy/shared";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../../components/Toasts";
import { mergeValues, promptText, splitParams, valuesForSubmit } from "../../create/formValues";
import { useCreateFormState } from "../../create/hooks/CreateFormProvider";
import { useCreateJob } from "../../jobs/hooks/useJobMutations";
import { useNsfwVisible } from "../../settings/hooks/useSettings";
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
  const nsfwVisible = useNsfwVisible();

  /** The result's workflow if the form can switch to it; otherwise says why not and returns nothing. */
  const selectableWorkflow = useCallback(
    (image: AppImage): PublicWorkflow | undefined => {
      const workflow = workflows?.find((candidate) => candidate.id === image.workflowId);
      const problem = !workflow
        ? "That workflow is no longer installed."
        : workflow.nsfw && !nsfwVisible
          ? "That workflow is hidden. Turn on NSFW content in Settings to use it."
          : !workflow.available
            ? `That workflow needs attention: ${workflow.unavailableReason ?? "unavailable"}.`
            : undefined;
      if (problem) notify(problem, "error");
      return problem ? undefined : workflow;
    },
    [workflows, nsfwVisible, notify],
  );

  const reuseSettings = useCallback(
    (image: AppImage) => {
      const workflow = selectableWorkflow(image);
      if (!workflow) return;
      const values = mergeValues(workflow, image.params);
      if (image.seed !== null && "seed" in values) values.seed = image.seed;
      form.replaceValues(workflow.id, values);
      navigate("/");
    },
    [selectableWorkflow, form, navigate],
  );

  const reusePrompt = useCallback(
    (image: AppImage) => {
      const workflow = selectableWorkflow(image);
      if (!workflow) return;
      const promptId = splitParams(workflow).prompt?.id;
      if (!promptId) return notify("That workflow has no prompt to reuse.", "error");
      form.selectWorkflow(workflow.id);
      form.setValue(
        workflow.id,
        promptId,
        promptText(workflow, mergeValues(workflow, image.params)),
      );
      navigate("/");
    },
    [selectableWorkflow, form, navigate, notify],
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
