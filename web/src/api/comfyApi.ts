import {
  type AppImage,
  type AppSettings,
  type CreateJobRequest,
  type ImageListQuery,
  type ImagePage,
  imagePageSchema,
  imageSchema,
  type Job,
  jobSchema,
  type PublicWorkflow,
  publicWorkflowSchema,
  type SystemStatus,
  settingsSchema,
  systemStatusSchema,
  type UpdateImageRequest,
  type Viewer,
  viewerSchema,
} from "@comfy/shared";
import { z } from "zod";
import { jsonBody, request, requestJson } from "./client";

type ImageFilters = Partial<Pick<ImageListQuery, "kind" | "workflowId" | "search" | "cursor">> & {
  favourite?: boolean;
  /** False hides images marked NSFW. */
  nsfw?: boolean;
  limit?: number;
};

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Every backend operation the SPA performs. */
export const comfyApi = {
  viewer: (): Promise<Viewer> => requestJson("/api/viewer", viewerSchema),
  system: (): Promise<SystemStatus> => requestJson("/api/system", systemStatusSchema),

  login: async (token: string): Promise<void> => {
    await request("/api/auth/login", { method: "POST", ...jsonBody({ token }) });
  },
  logout: async (): Promise<void> => {
    await request("/api/auth/logout", { method: "POST" });
  },

  settings: (): Promise<AppSettings> => requestJson("/api/settings", settingsSchema),
  saveSettings: (settings: AppSettings): Promise<AppSettings> =>
    requestJson("/api/settings", settingsSchema, { method: "PUT", ...jsonBody(settings) }),

  workflows: (): Promise<PublicWorkflow[]> =>
    requestJson("/api/workflows", z.array(publicWorkflowSchema)),
  refreshWorkflows: (): Promise<PublicWorkflow[]> =>
    requestJson("/api/workflows/refresh", z.array(publicWorkflowSchema), { method: "POST" }),
  workflowPreviewUrl: (id: string): string => `/api/workflows/${encodeURIComponent(id)}/preview`,

  jobs: (limit = 60): Promise<Job[]> =>
    requestJson(`/api/jobs${queryString({ limit })}`, z.array(jobSchema)),
  createJob: (body: CreateJobRequest): Promise<Job> =>
    requestJson("/api/jobs", jobSchema, { method: "POST", ...jsonBody(body) }),
  cancelJob: (id: string): Promise<Job> =>
    requestJson(`/api/jobs/${encodeURIComponent(id)}/cancel`, jobSchema, { method: "POST" }),

  images: (filters: ImageFilters): Promise<ImagePage> =>
    requestJson(
      `/api/images${queryString({
        ...filters,
        favourite: filters.favourite ? "true" : undefined,
        nsfw: filters.nsfw === false ? "false" : undefined,
      })}`,
      imagePageSchema,
    ),
  updateImage: (id: string, patch: UpdateImageRequest): Promise<AppImage> =>
    requestJson(`/api/images/${encodeURIComponent(id)}`, imageSchema, {
      method: "PATCH",
      ...jsonBody(patch),
    }),
  deleteImage: async (id: string): Promise<void> => {
    await request(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  uploadImage: (file: File): Promise<AppImage> => {
    const form = new FormData();
    form.set("image", file);
    return requestJson("/api/uploads", imageSchema, { method: "POST", body: form });
  },

  thumbUrl: (id: string): string => `/api/images/${encodeURIComponent(id)}/thumb`,
  fileUrl: (id: string): string => `/api/images/${encodeURIComponent(id)}/file`,
  downloadUrl: (id: string): string => `/api/images/${encodeURIComponent(id)}/file?download=1`,
};
