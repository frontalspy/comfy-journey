import type { WorkflowManifest } from "@comfy/shared";
import type { ComfyWorkflow } from "../comfy/types.js";
import { type ChosenModifier, insertModifierChain } from "./modifierChain.js";
import { encodeH3MediaState, type ResolvedImage } from "./resolvedImages.js";
import { buildValuesSchema } from "./valuesSchema.js";

export class WorkflowParamsError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid workflow values: ${issues.join("; ")}`);
    this.name = "WorkflowParamsError";
    this.issues = issues;
  }
}

export interface AppliedWorkflow {
  /** A new graph; the template is never mutated. */
  workflow: ComfyWorkflow;
  /**
   * Every exposed value after defaults and the random seed were resolved (saved as the snapshot).
   * An `images` parameter holds the ResolvedImage objects it was given, not stored image ids: the
   * caller keeps the ids for the snapshot.
   */
  values: Record<string, unknown>;
}

export interface ApplyOptions {
  /** [0, 1) source for random seeds and media uids. Defaults to Math.random. */
  random?: () => number;
}

const RANDOM_SEED_RANGE = 2 ** 32;

/**
 * Sets only what the manifest exposes. Unknown ids, out-of-range values and wrong types throw
 * WorkflowParamsError. For an `image` parameter the worker passes the ComfyUI file name it
 * uploaded, not the stored image id; for `images` an array of ResolvedImage. An optional image
 * left out leaves the template untouched.
 */
export function applyParams(
  template: ComfyWorkflow,
  manifest: WorkflowManifest,
  values: Record<string, unknown>,
  options: ApplyOptions = {},
): AppliedWorkflow {
  const parsed = buildValuesSchema(manifest, { images: "resolved" }).safeParse(values);
  if (!parsed.success) {
    throw new WorkflowParamsError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "values"}: ${issue.message}`),
    );
  }
  const random = options.random ?? Math.random;
  const resolved: Record<string, unknown> = { ...parsed.data };
  const workflow = structuredClone(template);
  const removals = new Set<string>();

  for (const param of manifest.params) {
    let value = resolved[param.id];
    if (param.type === "modifiers") {
      try {
        insertModifierChain(workflow, param, (value ?? []) as ChosenModifier[]);
      } catch (err) {
        throw new WorkflowParamsError([err instanceof Error ? err.message : String(err)]);
      }
      continue;
    }
    if (param.type === "seed" && value === -1) {
      value = Math.floor(random() * RANDOM_SEED_RANGE);
      resolved[param.id] = value;
    }
    if (param.type === "boolean" && value === false) {
      for (const nodeId of param.removeWhenOff ?? []) removals.add(nodeId);
    }
    if (value === undefined || !param.target) continue;
    const node = workflow[param.target.nodeId];
    if (!node) throw new WorkflowParamsError([`${param.id}: target node is missing`]);
    node.inputs[param.target.input] =
      param.type === "images" ? encodeH3MediaState(value as ResolvedImage[], random) : value;
  }
  for (const nodeId of removals) delete workflow[nodeId];
  return { workflow, values: resolved };
}
