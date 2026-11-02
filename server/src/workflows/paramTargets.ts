import type { ManifestParam, ParamTarget } from "@comfy/shared";

/** The node inputs a parameter writes directly (a modifiers chain's targets are in `chain`). */
export function paramTargets(param: ManifestParam): ParamTarget[] {
  if (param.type === "modifiers") return [];
  return param.target ? [param.target] : [];
}

/** Every input the manifest sets, the modifier chain's consumers included. */
export function allTargets(params: readonly ManifestParam[]): ParamTarget[] {
  return params.flatMap((param) =>
    param.type === "modifiers"
      ? [...param.chain.model.consumers, ...param.chain.clip.consumers]
      : paramTargets(param),
  );
}
