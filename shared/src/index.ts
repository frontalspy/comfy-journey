// The app's contracts: zod schemas and inferred types shared by the server and the SPA.
// Browser-safe on purpose: depends on zod only, imports nothing from node or the server.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Workflow manifest (server-side file, workflows/<id>/manifest.json)
// ---------------------------------------------------------------------------

export const WORKFLOW_KINDS = ["txt2img", "img2img", "upscale", "i2v", "t2v"] as const;
export const workflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof workflowKindSchema>;

/** Folder-safe, URL-safe id. */
export const workflowIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and dashes");

/** The node input a parameter writes to. Never leaves the server. */
export const paramTargetSchema = z.object({
  nodeId: z.string().min(1),
  input: z.string().min(1),
});
export type ParamTarget = z.infer<typeof paramTargetSchema>;

const paramBase = {
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  group: z.string().max(40).optional(),
  advanced: z.boolean().default(false),
};

const textShape = {
  ...paramBase,
  type: z.literal("text"),
  default: z.string(),
  multiline: z.boolean().default(false),
  /** Further capped by the global prompt limit. */
  maxLength: z.number().int().positive().optional(),
};
const intShape = {
  ...paramBase,
  type: z.literal("int"),
  default: z.number().int(),
  min: z.number().int(),
  max: z.number().int(),
  step: z.number().int().positive().optional(),
};
const floatShape = {
  ...paramBase,
  type: z.literal("float"),
  default: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
};
const enumShape = {
  ...paramBase,
  type: z.literal("enum"),
  default: z.string(),
  choices: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
};
/** -1 means "pick a random seed for each run". */
const seedShape = { ...paramBase, type: z.literal("seed"), default: z.number().int() };
const booleanShape = { ...paramBase, type: z.literal("boolean"), default: z.boolean() };
/** The value is a stored image id; the server uploads that image to ComfyUI itself. */
const imageShape = {
  ...paramBase,
  type: z.literal("image"),
  default: z.null().default(null),
  required: z.boolean().default(true),
};

/**
 * A list of optional add-ons the user picks from a fixed menu, each with its own strength (LoRAs;
 * the UI calls them "modifiers"). The value is `{ id, strength }[]`, in the order chosen; `id` is a
 * choice's `value`, an opaque slug, never a file name. Zero is a valid choice.
 */
const modifierChoiceShape = {
  value: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  /** Words to put in the prompt for this modifier to take effect; shown as a hint. */
  triggerWords: z.array(z.string().max(80)).max(20).optional(),
};
const modifiersShape = {
  ...paramBase,
  type: z.literal("modifiers"),
  default: z.array(z.object({ id: z.string(), strength: z.number() })).default([]),
  maxCount: z.number().int().min(1).max(10),
  strength: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    default: z.number(),
  }),
};
/**
 * Several stored images (uploads or earlier results) used as references. The value is an array of
 * stored image ids; the server uploads each to ComfyUI itself.
 */
const imagesShape = {
  ...paramBase,
  type: z.literal("images"),
  default: z.array(z.string()).default([]),
  minCount: z.number().int().min(0).default(0),
  maxCount: z.number().int().min(1).max(12),
};

/** A parameter as the browser sees it: no target. */
export const publicParamSchema = z.discriminatedUnion("type", [
  z.object(textShape),
  z.object(intShape),
  z.object(floatShape),
  z.object(enumShape),
  z.object(seedShape),
  z.object(booleanShape),
  z.object(imageShape),
  z.object({ ...modifiersShape, choices: z.array(z.object(modifierChoiceShape)).min(1) }),
  z.object(imagesShape),
]);
export type PublicParam = z.infer<typeof publicParamSchema>;

/** A parameter as written in manifest.json: the public shape plus the node input it sets. */
export const manifestParamSchema = z.discriminatedUnion("type", [
  z.object({ ...textShape, target: paramTargetSchema }),
  z.object({ ...intShape, target: paramTargetSchema }),
  z.object({ ...floatShape, target: paramTargetSchema }),
  z.object({ ...enumShape, target: paramTargetSchema }),
  z.object({ ...seedShape, target: paramTargetSchema }),
  z.object({
    ...booleanShape,
    /** Optional: a boolean may only switch a branch of the graph on or off. */
    target: paramTargetSchema.optional(),
    /**
     * Node ids deleted from the graph when the value is false (an optional branch, e.g. the video
     * part of an image workflow). The remaining graph must not reference a removed node: the loader
     * rejects the manifest if it does. A boolean needs a target, removeWhenOff, or both.
     */
    removeWhenOff: z.array(z.string().min(1)).optional(),
  }),
  z.object({ ...imageShape, target: paramTargetSchema }),
  z.object({
    ...modifiersShape,
    choices: z.array(z.object({ ...modifierChoiceShape, file: z.string().min(1).max(200) })).min(1),
    /**
     * Where the chain goes. The graph is stored WITHOUT any LoRA loader: `from` is the output the
     * chain starts at ([nodeId, outputSlot] of the model / clip source) and `consumers` are the
     * inputs that read the end of the chain. The server inserts one LoraLoader per chosen modifier,
     * in order, between them. With none chosen, consumers read `from` directly.
     */
    chain: z.object({
      model: z.object({
        from: z.tuple([z.string(), z.number().int()]),
        consumers: z.array(paramTargetSchema).min(1),
      }),
      clip: z.object({
        from: z.tuple([z.string(), z.number().int()]),
        consumers: z.array(paramTargetSchema).min(1),
      }),
    }),
  }),
  z.object({
    ...imagesShape,
    /** The input that receives the encoded list. */
    target: paramTargetSchema,
    /**
     * How the uploaded file names become the input's value. "h3-media-state" is the JSON list the
     * MiniMax H3 media loader reads: [{kind:"picture", file:"<subfolder>/<name> [input]", ...}].
     */
    encoder: z.enum(["h3-media-state"]),
    /** ComfyUI input subfolder the images are uploaded to (server-chosen, e.g. "comfy"). */
    uploadSubfolder: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  }),
]);
export type ManifestParam = z.infer<typeof manifestParamSchema>;
export type ParamType = ManifestParam["type"];

export const workflowManifestSchema = z.object({
  id: workflowIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  kind: workflowKindSchema,
  nsfw: z.boolean().default(false),
  /** File name of a preview image next to the manifest. */
  preview: z.string().optional(),
  params: z.array(manifestParamSchema),
});
export type WorkflowManifest = z.infer<typeof workflowManifestSchema>;

// ---------------------------------------------------------------------------
// Public workflow DTO
// ---------------------------------------------------------------------------

export const publicWorkflowSchema = z.object({
  id: workflowIdSchema,
  name: z.string(),
  description: z.string(),
  kind: workflowKindSchema,
  nsfw: z.boolean(),
  preview: z.string().optional(),
  params: z.array(publicParamSchema),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export type PublicWorkflow = z.infer<typeof publicWorkflowSchema>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  "queued",
  "waiting_for_gpu",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled"];

/** Values are validated against the workflow's own schema server-side (buildValuesSchema). */
export const createJobRequestSchema = z.object({
  workflowId: workflowIdSchema,
  values: z.record(z.string(), z.unknown()),
});
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const jobSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(1).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  imageIds: z.array(z.string()),
});
export type Job = z.infer<typeof jobSchema>;

export const jobEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), jobId: z.string(), status: jobStatusSchema }),
  z.object({ type: z.literal("progress"), jobId: z.string(), progress: z.number().min(0).max(1) }),
  z.object({ type: z.literal("image"), jobId: z.string(), imageId: z.string() }),
  z.object({ type: z.literal("done"), jobId: z.string(), imageIds: z.array(z.string()) }),
  z.object({ type: z.literal("error"), jobId: z.string(), message: z.string() }),
]);
export type JobEvent = z.infer<typeof jobEventSchema>;

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const imageSchema = z.object({
  id: z.string(),
  /** Null for an upload (no job made it). */
  jobId: z.string().nullable(),
  kind: z.enum(["image", "video"]),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  mime: z.string(),
  bytes: z.number().int(),
  seed: z.number().int().nullable(),
  nsfw: z.boolean(),
  favourite: z.boolean(),
  parentImageId: z.string().nullable(),
  createdAt: z.string(),
  /** The prompt, truncated for display and alt text. */
  promptSummary: z.string(),
  workflowId: z.string(),
  /** "upload" for a reference the user added; those never appear in the gallery. */
  source: z.enum(["generated", "upload"]).default("generated"),
  /** The values the job ran with, so a result can be re-run ("reuse settings"). */
  params: z.record(z.string(), z.unknown()),
  /** False for outputs with no thumbnail (an mp4): GET /thumb answers 404 for those. */
  hasThumb: z.boolean().optional(),
});
export type AppImage = z.infer<typeof imageSchema>;

export const imageListQuerySchema = z.object({
  kind: z.enum(["image", "video"]).optional(),
  favourite: z.enum(["true", "false"]).optional(),
  nsfw: z.enum(["true", "false"]).optional(),
  workflowId: workflowIdSchema.optional(),
  /** Default "generated": the gallery. "upload" lists the user's reference uploads. */
  source: z.enum(["generated", "upload"]).default("generated"),
  search: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ImageListQuery = z.infer<typeof imageListQuerySchema>;

/** PATCH /api/images/:id: only these fields are ever writable. */
export const updateImageRequestSchema = z
  .object({ favourite: z.boolean().optional(), nsfw: z.boolean().optional() })
  .strict();
export type UpdateImageRequest = z.infer<typeof updateImageRequestSchema>;

export const imagePageSchema = z.object({
  items: z.array(imageSchema),
  nextCursor: z.string().nullable(),
});
export type ImagePage = z.infer<typeof imagePageSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({ nsfwVisible: z.boolean() });
export type AppSettings = z.infer<typeof settingsSchema>;
export const updateSettingsRequestSchema = settingsSchema.strict();

// ---------------------------------------------------------------------------
// System and viewer
// ---------------------------------------------------------------------------

export const systemStatusSchema = z.object({
  comfyui: z.enum(["up", "offline"]),
  /** Jobs waiting in this app's own queue, all owners. */
  queueLength: z.number().int().min(0),
  /** The shared GPU queue: apps and positions only, never who or what. Position 0 holds the GPU. */
  gpuQueue: z.array(
    z.object({ app: z.string().min(1).max(40), position: z.number().int().min(0) }),
  ),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const viewerSchema = z.object({ id: z.string() });
export type Viewer = z.infer<typeof viewerSchema>;
