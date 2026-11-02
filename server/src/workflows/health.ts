import type { ManifestParam, ParamTarget } from "@comfy/shared";
import type { ComfyObjectInfo, ComfyWorkflow } from "../comfy/types.js";

export interface WorkflowHealth {
  ok: boolean;
  /** Short owner-facing reasons, e.g. a missing custom node or model file. */
  problems: string[];
}

/** Loader nodes pin model files; LoadImage takes an uploaded input and is never a model. */
function isLockedLoader(classType: string): boolean {
  return /load/i.test(classType) && !/^LoadImage/i.test(classType);
}

/** The allowed values of an input in /object_info, in the old `[[...]]` and new `["COMBO", {options}]` shapes. */
function enumOptions(spec: unknown): string[] | undefined {
  if (!Array.isArray(spec)) return undefined;
  const [first, meta] = spec as [unknown, unknown];
  if (Array.isArray(first)) return first.filter((v): v is string => typeof v === "string");
  if (first === "COMBO" && typeof meta === "object" && meta !== null) {
    const options = (meta as { options?: unknown }).options;
    if (Array.isArray(options)) return options.filter((v): v is string => typeof v === "string");
  }
  return undefined;
}

/** Each modifier's LoRA file must be one ComfyUI lists; the reason names the label, not the file. */
function checkModifierFiles(
  params: readonly ManifestParam[],
  objectInfo: ComfyObjectInfo,
  problems: Set<string>,
): void {
  for (const param of params) {
    if (param.type !== "modifiers") continue;
    const info = objectInfo.LoraLoader;
    if (!info) {
      problems.add("Missing node type LoraLoader");
      return;
    }
    const specs = { ...info.input?.optional, ...info.input?.required };
    const options = enumOptions(specs.lora_name);
    if (!options) continue;
    for (const choice of param.choices) {
      if (!options.includes(choice.file)) {
        problems.add(`Modifier "${choice.label}" is not installed`);
      }
    }
  }
}

/**
 * Compares a template with ComfyUI's /object_info: every node class must exist, and every
 * locked loader's literal model-file inputs must be one of the files ComfyUI lists. Inputs the
 * manifest exposes (`exposed`) are skipped, since users pick those from a bounded list.
 */
export function checkWorkflowHealth(
  template: ComfyWorkflow,
  objectInfo: ComfyObjectInfo,
  exposed: readonly ParamTarget[] = [],
  params: readonly ManifestParam[] = [],
): WorkflowHealth {
  const problems = new Set<string>();
  const isExposed = (nodeId: string, input: string): boolean =>
    exposed.some((target) => target.nodeId === nodeId && target.input === input);

  for (const [nodeId, node] of Object.entries(template)) {
    const info = objectInfo[node.class_type];
    if (!info) {
      problems.add(`Missing node type ${node.class_type}`);
      continue;
    }
    if (!isLockedLoader(node.class_type)) continue;
    const specs = { ...info.input?.optional, ...info.input?.required };
    for (const [input, value] of Object.entries(node.inputs)) {
      if (typeof value !== "string" || isExposed(nodeId, input)) continue;
      const options = enumOptions(specs[input]);
      if (options && !options.includes(value)) {
        problems.add(`Missing model file ${value} (${node.class_type}.${input})`);
      }
    }
  }
  checkModifierFiles(params, objectInfo, problems);
  return { ok: problems.size === 0, problems: [...problems] };
}
