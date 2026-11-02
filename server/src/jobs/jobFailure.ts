import { ComfyError } from "../comfy/errors.js";
import { MediaStorageError } from "../storage/mediaBackend.js";
import { WorkflowParamsError } from "../workflows/applyParams.js";

/** Thrown by the runner for a failure whose user-facing text is already decided. */
export class JobFailure extends Error {}

export const MESSAGES = {
  unavailable: "Image generation is unavailable right now. Try again later.",
  rejected: "The workflow was rejected by ComfyUI.",
  failed: "Generation failed.",
  settings: "The workflow settings were rejected.",
  noOutput: "The workflow produced no usable output.",
  noSource: "An input image is no longer available.",
  inputsTooLarge: "The input images are too large to send together.",
  noWorkflow: "This workflow is no longer available.",
  storage: "The result could not be saved. Try again later.",
  interrupted: "Generation was interrupted by a restart.",
} as const;

/**
 * The only text a user ever sees about a failure. Raw ComfyUI payloads, node ids and file paths
 * stay in the server log; none of `error.message` is copied here.
 */
export function sanitiseFailure(error: unknown): string {
  if (error instanceof JobFailure) return error.message;
  if (error instanceof MediaStorageError) return MESSAGES.storage;
  if (error instanceof WorkflowParamsError) return MESSAGES.settings;
  if (error instanceof ComfyError) {
    if (error.kind === "http" || error.kind === "validation") return MESSAGES.rejected;
    if (error.kind === "unreachable" || error.kind === "timeout") return MESSAGES.unavailable;
  }
  return MESSAGES.failed;
}
