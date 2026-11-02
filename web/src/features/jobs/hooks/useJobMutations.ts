import type { CreateJobRequest, Job } from "@comfy/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { comfyApi } from "../../../api/comfyApi";
import { useToast } from "../../../components/Toasts";
import { rememberJob } from "../jobMeta";
import { JOBS_KEY } from "./useJobs";

interface CreateJobInput {
  request: CreateJobRequest;
  prompt: string;
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: ({ request }: CreateJobInput) => comfyApi.createJob(request),
    onSuccess: (job, { request, prompt }) => {
      rememberJob(job.id, { workflowId: request.workflowId, prompt, values: request.values });
      queryClient.setQueryData<Job[]>(JOBS_KEY, (current) => [
        job,
        ...(current ?? []).filter((existing) => existing.id !== job.id),
      ]);
    },
    onError: (error) => notify(error.message, "error"),
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: comfyApi.cancelJob,
    onSuccess: (job) => {
      queryClient.setQueryData<Job[]>(JOBS_KEY, (current) =>
        (current ?? []).map((existing) => (existing.id === job.id ? job : existing)),
      );
    },
    onError: (error) => notify(error.message, "error"),
  });
}
